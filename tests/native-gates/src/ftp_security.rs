//! Synthetic loopback integration for the FTP major-version/security migration.
use std::sync::Arc;
use suppaftp::{tokio::AsyncFtpStream, types::FileType, Mode};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

const PAYLOAD: &[u8] = b"synthetic\0payload\n";

async fn fixture() -> (
    AsyncFtpStream,
    Arc<Mutex<Vec<String>>>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let commands = Arc::clone(&seen);
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let (read, mut write) = socket.into_split();
        let mut lines = BufReader::new(read).lines();
        let mut data_listener: Option<TcpListener> = None;
        write
            .write_all(b"220 synthetic fixture ready\r\n")
            .await
            .unwrap();
        while let Some(line) = lines.next_line().await.unwrap() {
            commands.lock().await.push(line.clone());
            let verb = line.split(' ').next().unwrap();
            match verb {
                "USER" => write
                    .write_all(b"331 synthetic password required\r\n")
                    .await
                    .unwrap(),
                "PASS" => write
                    .write_all(b"230 synthetic login accepted\r\n")
                    .await
                    .unwrap(),
                "TYPE" | "NOOP" => write.write_all(b"200 ok\r\n").await.unwrap(),
                "PWD" => write.write_all(b"257 \"/fixture\"\r\n").await.unwrap(),
                "CWD" | "DELE" => write.write_all(b"250 ok\r\n").await.unwrap(),
                "PASV" | "EPSV" => {
                    let data = TcpListener::bind("127.0.0.1:0").await.unwrap();
                    let port = data.local_addr().unwrap().port();
                    let reply = if verb == "EPSV" {
                        format!("229 extended (|||{port}|)\r\n")
                    } else {
                        format!("227 passive (127,0,0,1,{},{})\r\n", port / 256, port % 256)
                    };
                    data_listener = Some(data);
                    write.write_all(reply.as_bytes()).await.unwrap();
                }
                "RETR" | "STOR" => {
                    write.write_all(b"150 opening data\r\n").await.unwrap();
                    let (mut data, _) = data_listener.take().unwrap().accept().await.unwrap();
                    if verb == "RETR" {
                        data.write_all(PAYLOAD).await.unwrap();
                    } else {
                        let mut bytes = Vec::new();
                        data.read_to_end(&mut bytes).await.unwrap();
                        assert_eq!(bytes, PAYLOAD);
                    }
                    drop(data);
                    write
                        .write_all(b"226 transfer completed\r\n")
                        .await
                        .unwrap();
                }
                "QUIT" => {
                    write.write_all(b"221 bye\r\n").await.unwrap();
                    break;
                }
                _ => panic!("unexpected synthetic FTP verb {verb}"),
            }
        }
    });
    let ftp = AsyncFtpStream::connect(addr).await.unwrap();
    (ftp, seen, task)
}

#[tokio::test]
async fn ftp_crlf_arguments_never_reach_the_control_wire() {
    let (mut ftp, seen, server) = fixture().await;
    assert!(ftp.login("bad\r\nDELE victim", "synthetic").await.is_err());
    assert!(seen.lock().await.is_empty());
    ftp.login("synthetic", "synthetic").await.unwrap();
    assert!(ftp.cwd("folder\r\nDELE victim").await.is_err());
    assert!(ftp.rm("file\nDELE victim").await.is_err());
    assert_eq!(ftp.pwd().await.unwrap(), "/fixture");
    assert!(seen
        .lock()
        .await
        .iter()
        .all(|s| !s.contains("DELE") && !s.contains("folder")));
    ftp.quit().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn ftp_transfer_finish_consumes_completion_before_the_next_command() {
    let (mut ftp, _seen, server) = fixture().await;
    ftp.login("synthetic", "synthetic").await.unwrap();
    ftp.set_mode(Mode::Passive);
    ftp.transfer_type(FileType::Binary).await.unwrap();
    let mut download = ftp.retr_as_stream("fixture.bin").await.unwrap();
    let mut bytes = Vec::new();
    download.read_to_end(&mut bytes).await.unwrap();
    assert_eq!(bytes, PAYLOAD);
    download.finish().await.unwrap();
    assert_eq!(ftp.pwd().await.unwrap(), "/fixture");
    let mut upload = ftp.put_with_stream("fixture.bin").await.unwrap();
    upload.write_all(PAYLOAD).await.unwrap();
    upload.finish().await.unwrap();
    assert_eq!(ftp.pwd().await.unwrap(), "/fixture");
    ftp.quit().await.unwrap();
    server.await.unwrap();
}

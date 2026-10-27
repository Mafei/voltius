"""Attach a synthetic TUIOS client in a PTY, then detach without stopping its daemon."""
import json, os, pty, select, signal, subprocess, sys, time, fcntl, termios, struct
assert os.environ.get('TUIOS_SERVER', '').startswith('vrec-'), 'isolated named daemon required'
child, fd = pty.fork()
if child == 0:
    os.execvp('/bin/sh', ['sh', '-c', sys.argv[1]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
status = None
try:
    attached = False
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try: os.read(fd, 65536)
            except OSError: break
        result = subprocess.run(['tuios', 'ls', '--json'], capture_output=True, text=True, timeout=3)
        if result.returncode == 0 and any(s.get('attached') for s in json.loads(result.stdout)):
            attached = True
            break
    assert attached, 'synthetic client did not attach'
    os.write(fd, b'\x02d')
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        pid, result = os.waitpid(child, os.WNOHANG)
        if pid:
            status = result
            break
        if select.select([fd], [], [], .1)[0]:
            try: os.read(fd, 65536)
            except OSError: pass
    assert status is not None and os.waitstatus_to_exitcode(status) == 0, 'detach failed'
    print('synthetic PTY attach/detach passed')
finally:
    if status is None:
        os.kill(child, signal.SIGTERM)
        os.waitpid(child, 0)
    os.close(fd)

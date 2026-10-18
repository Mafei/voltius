// Own-window WKWebView probe: no screen-recording, Accessibility or security-policy change.
import AppKit
import Foundation
import WebKit

final class RenderProbe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let baseURL: String
    let output: URL
    let seconds: String
    let modes: [String]
    let diagnostic: Bool
    var index = 0
    var failed = false
    var webView: WKWebView?
    var window: NSWindow!

    init(arguments: [String]) {
        baseURL = arguments[1]
        output = URL(fileURLWithPath: arguments[2], isDirectory: true)
        seconds = arguments[3]
        modes = arguments[4].components(separatedBy: ",")
        diagnostic = arguments.contains("--diagnostic")
        super.init()
    }

    func start() throws {
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Synthetic terminal rendering probe"
        window.center()
        loadMode()
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(seconds)! * Double(modes.count) + 600) {
            fputs("WKWebView rendering probe timed out\n", stderr)
            exit(2)
        }
    }

    func loadMode() {
        if index == modes.count { exit(failed ? 1 : 0) }
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "renderProbe")
        webView?.removeFromSuperview()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "renderProbe")
        let view = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        window.contentView!.addSubview(view)
        webView = view
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let url = URL(string: baseURL + "?precision=" + modes[index] + "&seconds=" + seconds)!
        view.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("WKWebView navigation failed: \(error)\n", stderr)
        exit(2)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let phase = body["phase"] as? String else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            print(String(data: data, encoding: .utf8)!)
            fflush(stdout)
            if phase == "error" {
                try data.write(to: output.appendingPathComponent("terminal-render-\(modes[index])-error.json"))
                exit(1)
            }
            if phase != "complete" { return }
            var result = body
            result["native_engine"] = "WKWebView on macOS ARM64"
            result["os_version"] = ProcessInfo.processInfo.operatingSystemVersionString
            result["window_backing_scale"] = window.backingScaleFactor
            result["scope"] = "Production xterm renderer and fonts in a native WKWebView harness; not a full Voltius app interaction or real SSH test."
            try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("terminal-render-\(modes[index]).json"))
            if (body["failed_checks"] as? Int ?? 1) != 0 && !diagnostic { failed = true }
            if let micro = body["precision"] as? [[String: Any]], micro.contains(where: { ($0["precision"] as? String) == "highp" && ($0["mismatch_pixels"] as? Int ?? 1) != 0 }) { failed = true }
            let mode = modes[index]
            webView!.takeSnapshot(with: nil) { image, error in
                do {
                    if let image = image, let tiff = image.tiffRepresentation,
                       let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                        try png.write(to: self.output.appendingPathComponent("terminal-render-\(mode).png"))
                    } else {
                        fputs("Own-view snapshot unavailable: \(String(describing: error))\n", stderr)
                    }
                    self.index += 1
                    self.loadMode()
                } catch { fputs("Snapshot write failed: \(error)\n", stderr); exit(2) }
            }
        } catch { fputs("Render evidence failed: \(error)\n", stderr); exit(2) }
    }
}

guard CommandLine.arguments.count >= 5 else { fputs("URL, evidence directory, seconds and modes required\n", stderr); exit(2) }
#if !arch(arm64)
fputs("ARM64 host required\n", stderr)
exit(2)
#endif
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let probe = RenderProbe(arguments: CommandLine.arguments)
do { try probe.start() } catch { fputs("Probe setup failed: \(error)\n", stderr); exit(2) }
application.run()

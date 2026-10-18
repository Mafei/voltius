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
    var baselinePixels: [UInt8]?
    var baselineSize: [Int]?
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
        baselinePixels = nil
        baselineSize = nil
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
        if phase == "snapshot" { capture(body); return }
        if phase == "native-keys", let keys = body["keys"] as? [String] { dispatchKeys(keys); return }
        if phase == "zoom", let value = body["value"] as? Double {
            webView!.pageZoom = value
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.webView?.evaluateJavaScript("window.__terminalZoomAck()", completionHandler: nil) }
            return
        }
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
                    if let image = image {
                        try self.savePNG(image, name: "terminal-render-\(mode).png")
                    } else {
                        fputs("Own-view snapshot unavailable: \(String(describing: error))\n", stderr)
                    }
                    self.index += 1
                    self.loadMode()
                } catch { fputs("Snapshot write failed: \(error)\n", stderr); exit(2) }
            }
        } catch { fputs("Render evidence failed: \(error)\n", stderr); exit(2) }
    }

    func capture(_ request: [String: Any]) {
        guard let label = request["label"] as? String, let rect = request["rect"] as? [String: Double] else { exit(2) }
        let configuration = WKSnapshotConfiguration()
        configuration.rect = CGRect(x: rect["x"]!, y: rect["y"]!, width: rect["width"]!, height: rect["height"]!)
        configuration.afterScreenUpdates = true
        webView!.takeSnapshot(with: configuration) { image, error in
            guard let image = image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                fputs("Native composited snapshot unavailable: \(String(describing: error))\n", stderr)
                exit(2)
            }
            let width = cg.width, height = cg.height
            var pixels = [UInt8](repeating: 0, count: width * height * 4)
            pixels.withUnsafeMutableBytes { raw in
                let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
                context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            }
            var colors: [UInt32: Int] = [:]
            for i in stride(from: 0, to: pixels.count, by: 4) {
                let color = UInt32(pixels[i]) << 16 | UInt32(pixels[i + 1]) << 8 | UInt32(pixels[i + 2])
                colors[color, default: 0] += 1
            }
            let foreground = width * height - (colors.values.max() ?? 0)
            let valid = foreground > 500
            if self.baselinePixels == nil { self.baselinePixels = pixels; self.baselineSize = [width, height] }
            var different = 0
            if self.baselinePixels!.count == pixels.count {
                for i in stride(from: 0, to: pixels.count, by: 4) {
                    if pixels[i] != self.baselinePixels![i] || pixels[i + 1] != self.baselinePixels![i + 1] || pixels[i + 2] != self.baselinePixels![i + 2] { different += 1 }
                }
            } else { different = max(pixels.count, self.baselinePixels!.count) / 4 }
            let result: [String: Any] = ["phase": "native-compositor-check", "label": label, "valid": valid, "different_pixels": different,
                "size": [width, height], "baseline_size": self.baselineSize!, "foreground_pixels": foreground, "method": "WKWebView.takeSnapshot of own synthetic view"]
            do {
                let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                print(String(data: data, encoding: .utf8)!); fflush(stdout)
                if label == "baseline" || label == "after-soak" || different != 0 || request["save"] as? Bool == true {
                    try self.savePNG(image, name: "composited-\(self.modes[self.index])-\(label).png")
                }
                self.webView!.evaluateJavaScript("window.__terminalSnapshotAck(" + String(data: data, encoding: .utf8)! + ")", completionHandler: nil)
            } catch { fputs("Native snapshot evidence failed: \(error)\n", stderr); exit(2) }
        }
    }

    func savePNG(_ image: NSImage, name: String) throws {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "SyntheticRenderProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Snapshot PNG encoding failed"])
        }
        try png.write(to: output.appendingPathComponent(name))
    }

    func dispatchKeys(_ keys: [String], index: Int = 0) {
        if index == keys.count { webView?.evaluateJavaScript("window.__terminalKeysAck()", completionHandler: nil); return }
        let mappings: [String: (UInt16, String, String, NSEvent.ModifierFlags)] = [
            "ctrl-b": (11, "\u{2}", "b", .control), "ctrl-g": (5, "\u{7}", "g", .control),
            "ctrl-enter": (36, "\r", "\r", .control), "enter": (36, "\r", "\r", [])
        ]
        guard let (code, text, base, flags) = mappings[keys[index]] else { fputs("Unsupported synthetic key\n", stderr); exit(2) }
        window.makeFirstResponder(webView)
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: text, charactersIgnoringModifiers: base, isARepeat: false, keyCode: code) else { exit(2) }
            window.sendEvent(event)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.dispatchKeys(keys, index: index + 1) }
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

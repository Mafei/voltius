import AppKit
import CoreGraphics
import Foundation

let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.voltius.app" }
guard let app = apps.first, !app.isTerminated else {
    fputs("Voltius did not remain running after normal LaunchServices open\n", stderr)
    exit(1)
}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) }
let evidence: [String: Any] = [
    "pid": app.processIdentifier,
    "bundleIdentifier": app.bundleIdentifier ?? "",
    "running": !app.isTerminated,
    "activationPolicy": app.activationPolicy.rawValue,
    "visibleWindowCount": owned.count,
    "windows": owned,
    "method": "open -n through LaunchServices; no quarantine or Gatekeeper changes"
]
let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
guard !owned.isEmpty else {
    fputs("Voltius is running but no visible window was detected; GUI launch is not verified\n", stderr)
    exit(1)
}

#!/usr/bin/env swift
// get_mirroring_bounds.swift
// Discovers the iPhone Mirroring window bounds via CoreGraphics.
// Outputs JSON: {"x": N, "y": N, "width": N, "height": N, "windowId": N}
// Handles both English ("iPhone Mirroring") and Chinese ("iPhone镜像") locales.

import Cocoa
import CoreGraphics
import Foundation

let options = CGWindowListOption(arrayLiteral: [.optionOnScreenOnly, .excludeDesktopElements])
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

func windowTitle(_ info: [String: Any]) -> String {
    (info[kCGWindowName as String] as? String) ?? ""
}
func ownerName(_ info: [String: Any]) -> String {
    (info[kCGWindowOwnerName as String] as? String) ?? ""
}
func windowBounds(_ info: [String: Any]) -> CGRect? {
    guard let dict = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: dict)
}
func windowId(_ info: [String: Any]) -> Int? {
    info[kCGWindowNumber as String] as? Int
}
func area(_ rect: CGRect) -> CGFloat { rect.width * rect.height }

let chosen = windows.compactMap { info -> [String: Any]? in
    let title = windowTitle(info)
    let owner = ownerName(info)
    guard title.contains("iPhone Mirroring")
        || title.contains("iPhone镜像")
        || owner.contains("iPhone Mirroring")
        || owner.contains("iPhone镜像")
    else { return nil }
    guard let rect = windowBounds(info), rect.width > 100, rect.height > 100 else { return nil }
    return [
        "rect": rect,
        "windowId": windowId(info) as Any,
        "title": title,
        "owner": owner,
    ]
}.sorted {
    guard let lhsRect = $0["rect"] as? CGRect, let rhsRect = $1["rect"] as? CGRect else { return false }
    return area(lhsRect) > area(rhsRect)
}.first

guard
    let chosen,
    let rect = chosen["rect"] as? CGRect
else {
    fputs("No iPhone Mirroring window found\n", stderr)
    exit(1)
}

var result: [String: Any] = [
    "x": Int(rect.origin.x.rounded()),
    "y": Int(rect.origin.y.rounded()),
    "width": Int(rect.width.rounded()),
    "height": Int(rect.height.rounded()),
]
if let id = chosen["windowId"] as? Int {
    result["windowId"] = id
}
if let title = chosen["title"] as? String, !title.isEmpty {
    result["title"] = title
}
if let owner = chosen["owner"] as? String, !owner.isEmpty {
    result["owner"] = owner
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)

import AppKit

let size = 1024
let out = URL(fileURLWithPath: CommandLine.arguments[1])

let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

// Same corner curve as the other Dock icons (about 22% of the side).
// The outside stays transparent so the Dock does not paint a square.
let radius = CGFloat(size) * 0.223
let shape = NSBezierPath(
    roundedRect: NSRect(x: 0, y: 0, width: size, height: size),
    xRadius: radius,
    yRadius: radius
)
NSColor(srgbRed: 0x0C / 255, green: 0x2E / 255, blue: 0x5A / 255, alpha: 1).setFill()
shape.fill()

let mark: CGFloat = 500
let origin = (CGFloat(size) - mark) / 2
let ring = NSBezierPath(
    roundedRect: NSRect(x: origin, y: origin, width: mark, height: mark),
    xRadius: 126,
    yRadius: 126
)
ring.lineWidth = 50
NSColor.white.setStroke()
ring.stroke()

let dot: CGFloat = 176
let dotOrigin = (CGFloat(size) - dot) / 2
let inner = NSBezierPath(
    roundedRect: NSRect(x: dotOrigin, y: dotOrigin, width: dot, height: dot),
    xRadius: 44,
    yRadius: 44
)
NSColor(srgbRed: 0x21 / 255, green: 0x91 / 255, blue: 0xFB / 255, alpha: 1).setFill()
inner.fill()

NSGraphicsContext.restoreGraphicsState()

let data = rep.representation(using: .png, properties: [:])!
try data.write(to: out)

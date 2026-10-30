import AppKit

let size = 1024
let out = URL(fileURLWithPath: CommandLine.arguments[1])

func squircle(in rect: CGRect, n: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    let a = rect.width / 2
    let b = rect.height / 2
    let cx = rect.midX
    let cy = rect.midY
    let steps = 720
    for i in 0...steps {
        let t = CGFloat(i) / CGFloat(steps) * 2 * .pi
        let ct = cos(t)
        let st = sin(t)
        let x = cx + a * (ct < 0 ? -1 : 1) * pow(abs(ct), 2 / n)
        let y = cy + b * (st < 0 ? -1 : 1) * pow(abs(st), 2 / n)
        if i == 0 { path.move(to: NSPoint(x: x, y: y)) }
        else { path.line(to: NSPoint(x: x, y: y)) }
    }
    path.close()
    return path
}

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

let shape = squircle(in: CGRect(x: 36, y: 36, width: 952, height: 952), n: 5)
NSColor(srgbRed: 0x0C / 255, green: 0x2E / 255, blue: 0x5A / 255, alpha: 1).setFill()
shape.fill()

let mark: CGFloat = 470
let origin = (CGFloat(size) - mark) / 2
let ring = NSBezierPath(
    roundedRect: NSRect(x: origin, y: origin, width: mark, height: mark),
    xRadius: 118,
    yRadius: 118
)
ring.lineWidth = 64
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

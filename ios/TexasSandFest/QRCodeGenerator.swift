import CoreImage.CIFilterBuiltins
import UIKit

enum QRCodeGenerator {
    /// Generate a high-correction QR code from an arbitrary string. Returns nil
    /// only if CoreImage refuses to render — we treat that as a programming bug
    /// in callers (don't pass empty strings, etc.).
    static func image(from string: String, scale: CGFloat = 12) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "H"

        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

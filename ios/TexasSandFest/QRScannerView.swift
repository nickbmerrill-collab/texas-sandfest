import AVFoundation
import SwiftUI
import UIKit

/// Live AVFoundation QR scanner. The camera view fills its container; when a
/// metadata QR is read we vibrate, surface the payload to the parent, and
/// stop the session. Designed for "show your Eventeny ticket QR to import it"
/// flows — handles any QR string, downstream code interprets the payload.

struct QRScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerVC {
        let vc = ScannerVC()
        vc.onScan = onScan
        return vc
    }

    func updateUIViewController(_ vc: ScannerVC, context: Context) {}
}

private final class CaptureSessionRunner: @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "tsf.qr.scanner")

    // AVCaptureSession is not Sendable, but all runtime mutations are confined
    // to this serial queue after the main actor finishes initial configuration.
    func start() {
        queue.async { [self] in
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }
}

@MainActor
final class ScannerVC: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
    var onScan: ((String) -> Void)?

    private let capture = CaptureSessionRunner()
    private var session: AVCaptureSession { capture.session }
    private var preview: AVCaptureVideoPreviewLayer!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configure()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        capture.start()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        capture.stop()
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            renderUnavailable()
            return
        }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            renderUnavailable()
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        installReticle()
    }

    private func renderUnavailable() {
        let label = UILabel()
        label.text = "Camera not available in this simulator. On device, Eventeny QR scanning works here."
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)
        ])
    }

    private func installReticle() {
        let reticle = UIView()
        reticle.translatesAutoresizingMaskIntoConstraints = false
        reticle.backgroundColor = .clear
        reticle.layer.borderColor = UIColor(red: 0.965, green: 0.839, blue: 0.435, alpha: 0.85).cgColor
        reticle.layer.borderWidth = 3
        reticle.layer.cornerRadius = 18
        view.addSubview(reticle)
        NSLayoutConstraint.activate([
            reticle.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            reticle.widthAnchor.constraint(equalToConstant: 240),
            reticle.heightAnchor.constraint(equalToConstant: 240)
        ])

        let hint = UILabel()
        hint.text = "Center your Eventeny ticket QR here"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 14, weight: .semibold)
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)
        NSLayoutConstraint.activate([
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.topAnchor.constraint(equalTo: reticle.bottomAnchor, constant: 18)
        ])
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let payload = object.stringValue,
              !payload.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onScan?(payload)
        // Stop after first hit so we don't fire repeatedly.
        capture.stop()
    }
}

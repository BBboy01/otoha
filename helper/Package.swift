// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "OtohaHelper",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "OtohaCore", targets: ["OtohaCore"]),
        .executable(name: "otoha-helper", targets: ["OtohaHelper"]),
    ],
    targets: [
        .target(name: "OtohaCore"),
        .executableTarget(name: "OtohaHelper", dependencies: ["OtohaCore"]),
        .testTarget(name: "OtohaCoreTests", dependencies: ["OtohaCore"]),
    ]
)

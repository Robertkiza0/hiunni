import SwiftUI
import SafariServices

enum Entry: String, CaseIterable, Identifiable {
    case home, information, rooms, meetups, my
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "하이언니 홈"
        case .information: return "정보공유"
        case .rooms: return "언니톡"
        case .meetups: return "모임"
        case .my: return "마이페이지"
        }
    }
    var symbol: String {
        switch self {
        case .home: return "house"
        case .information: return "sparkles"
        case .rooms: return "bubble.left.and.bubble.right"
        case .meetups: return "person.2"
        case .my: return "person.crop.circle"
        }
    }
    var fragment: String { self == .rooms ? "talk?view=rooms" : rawValue }
    var url: URL { URL(string: AppLinks.origin + "/#" + fragment)! }
}

enum AppLinks {
    static let host = "hiunni.kr"
    static let origin = "https://" + host
    static let install = URL(string: origin + "/#app-install")!
}

@main
struct HiUnniApp: App {
    var body: some Scene { WindowGroup { AppHome() } }
}

struct AppHome: View {
    @State private var entry: Entry?
    private let rose = Color(red: 0.71, green: 0.31, blue: 0.46)
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("HI, UNNI").font(.caption.weight(.semibold)).tracking(4).foregroundStyle(rose)
                    Text("우리의 하루가\n모이는 곳, 하이언니").font(.largeTitle.bold())
                    Text("익명 커뮤니티와 정보공유, 언니톡·모임을 한곳에서 이용해요.").foregroundStyle(.secondary)
                    ForEach(Entry.allCases) { item in
                        Button { entry = item } label: {
                            HStack(spacing: 16) {
                                Image(systemName: item.symbol).font(.title2).frame(width: 30)
                                Text(item.title).font(.headline).multilineTextAlignment(.leading)
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right").font(.caption)
                            }.padding(20).frame(maxWidth: .infinity, minHeight: 68)
                                .background(.white, in: RoundedRectangle(cornerRadius: 18))
                        }.buttonStyle(.plain).foregroundStyle(rose)
                    }
                    ShareLink(item: AppLinks.install, subject: Text("하이언니"), message: Text("하이언니 홈 화면 설치 안내")) {
                        Label("설치 안내 공유", systemImage: "square.and.arrow.up").frame(minHeight: 44)
                    }
                    Text("만 19세 이상 회원 대상이며, 처음 이용할 때 휴대폰 본인인증이 필요해요.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(24)
            }.background(Color(red: 1, green: 0.97, blue: 0.98))
                .navigationTitle("하이언니").navigationBarTitleDisplayMode(.inline)
                .sheet(item: $entry) { BrowserScreen(entry: $0) }
        }.tint(rose)
    }
}

// SafariServices keeps the Site sign-in and its redirects inside the system browser.
// The app never reads cookies, tokens, page contents or a private browsing URL.
struct SiteBrowser: UIViewControllerRepresentable {
    let url: URL
    let failed: (Bool) -> Void
    let finished: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(failed: failed, finished: finished) }
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: config)
        controller.delegate = context.coordinator
        controller.preferredControlTintColor = UIColor(red: 0.71, green: 0.31, blue: 0.46, alpha: 1)
        controller.dismissButtonStyle = .close
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        let failed: (Bool) -> Void
        let finished: () -> Void
        init(failed: @escaping (Bool) -> Void, finished: @escaping () -> Void) { self.failed = failed; self.finished = finished }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { finished() }
        func safariViewController(_ controller: SFSafariViewController, didCompleteInitialLoad didLoadSuccessfully: Bool) {
            failed(!didLoadSuccessfully)
        }
    }
}

struct BrowserScreen: View {
    let entry: Entry
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var failed = false
    @State private var attempt = UUID()
    var body: some View {
        ZStack {
            SiteBrowser(url: entry.url, failed: { failed = $0 }, finished: { dismiss() }).id(attempt)
            if phase == .background {
                Color(red: 1, green: 0.97, blue: 0.98).overlay(Text("하이언니").font(.title.bold()))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if failed {
                VStack(spacing: 10) {
                    Text("처음 화면을 불러오지 못했어요.").font(.headline)
                    Text("인터넷 연결을 확인한 뒤 다시 열어 주세요.").font(.footnote)
                    Button("다시 연결") { failed = false; attempt = UUID() }.buttonStyle(.borderedProminent)
                }.padding().frame(maxWidth: .infinity).background(.background)
            }
        }
    }
}

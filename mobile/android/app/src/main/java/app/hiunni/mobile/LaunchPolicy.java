package app.hiunni.mobile;

import java.net.URI;
import java.util.Arrays;
import java.util.List;

/** Incoming links only navigate. The server still checks access, consent and membership. */
public final class LaunchPolicy {
    public static final String ORIGIN = "https://hiunni.kr";
    public static final String HOME = ORIGIN + "/#home";
    private static final List<String> ROUTES = Arrays.asList("home", "information", "talk?view=rooms", "meetups", "my", "app-install");
    private static final String UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static boolean allowedFragment(String fragment) {
        if (ROUTES.contains(fragment)) return true;
        if (fragment == null) return false;
        // Share only the place overview or the group introduction. No member/chat subviews.
        return fragment.matches("service\\?origin=information&id=" + UUID)
            || fragment.matches("group/" + UUID)
            || fragment.matches("group-invite/" + UUID);
    }
    private LaunchPolicy() {}
    public static String resolve(String value) {
        if (value == null) return HOME;
        try {
            URI u = new URI(value);
            if (!"https".equals(u.getScheme()) || !"hiunni.kr".equals(u.getHost())
                || u.getUserInfo() != null || u.getPort() != -1 || u.getRawQuery() != null
                || !"/".equals(u.getRawPath()) || !allowedFragment(u.getRawFragment())) return HOME;
            return ORIGIN + "/#" + u.getRawFragment();
        } catch (Exception invalid) { return HOME; }
    }
}

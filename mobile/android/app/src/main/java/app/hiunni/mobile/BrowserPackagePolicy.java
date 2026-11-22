package app.hiunni.mobile;

import java.util.List;

/** Pure selection rule kept separate so the recursion guard is unit tested. */
public final class BrowserPackagePolicy {
    private BrowserPackagePolicy() {}

    public static String choose(String ownPackage, List<String> candidates) {
        if (candidates == null) return null;
        for (String candidate : candidates) {
            if (candidate != null && !candidate.trim().isEmpty() && !candidate.equals(ownPackage)) {
                return candidate;
            }
        }
        return null;
    }
}

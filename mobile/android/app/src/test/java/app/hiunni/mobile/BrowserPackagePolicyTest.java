package app.hiunni.mobile;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class BrowserPackagePolicyTest {
    @Test public void neverSelectsThisAppAsItsOwnBrowserFallback() {
        assertEquals("com.android.chrome", BrowserPackagePolicy.choose("app.hiunni.mobile",
            Arrays.asList("app.hiunni.mobile", "com.android.chrome", "com.sec.android.app.sbrowser")));
    }

    @Test public void supportsSamsungInternetWhenItIsTheAvailableBrowser() {
        assertEquals("com.sec.android.app.sbrowser", BrowserPackagePolicy.choose("app.hiunni.mobile",
            Arrays.asList(null, "", "com.sec.android.app.sbrowser")));
    }

    @Test public void failsClosedWhenThereIsNoExternalBrowser() {
        assertNull(BrowserPackagePolicy.choose("app.hiunni.mobile", Collections.singletonList("app.hiunni.mobile")));
        assertNull(BrowserPackagePolicy.choose("app.hiunni.mobile", null));
    }
}

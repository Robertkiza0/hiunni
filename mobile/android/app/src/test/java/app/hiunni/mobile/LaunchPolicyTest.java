package app.hiunni.mobile;
import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class LaunchPolicyTest {
    private static final String ID = "12345678-1234-4234-8234-123456789abc";
    @Test public void sharedPlaceGroupAndInviteOpenTheOriginalDestination() {
        for (String route : new String[]{"service?origin=information&id="+ID, "group/"+ID, "group-invite/"+ID}) {
            String link = LaunchPolicy.ORIGIN + "/#" + route;
            assertEquals(link, LaunchPolicy.resolve(link));
        }
    }
    @Test public void privateSubviewsAndAmbiguousLinksCannotBecomeSharedEntrypoints() {
        for (String route : new String[]{"group/"+ID+"?view=members", "group/"+ID+"/../my", "talk/"+ID,
            "group-invite/"+ID+"?join=1", "group/%31"+ID.substring(1), "group/"+ID+"#other", "group/invalid",
            "service?origin=information&id="+ID+"&mine=1", "service?origin=information&id="+ID+"&id="+ID,
            "service?origin=information&id="+ID+"&access_token=secret", "place-manage?id="+ID}) {
            assertEquals(LaunchPolicy.HOME, LaunchPolicy.resolve(LaunchPolicy.ORIGIN + "/#" + route));
        }
    }
    @Test public void rejectsAuthorityEncodingAndRedirectTricks() {
        String suffix="/#group/"+ID;
        for(String base:new String[]{"http://hiunni.kr",
            "https://hiunni.kr:443", "https://user@hiunni.kr",
            "https://hiunni.kr.evil.test", "https://hiunni.kr/other"})
            assertEquals(LaunchPolicy.HOME, LaunchPolicy.resolve(base+suffix));
        assertEquals(LaunchPolicy.HOME,LaunchPolicy.resolve(LaunchPolicy.ORIGIN+"/?return_to=https://evil.test"+suffix.substring(1)));
    }
    @Test public void launchesOnlyGenericSameOriginRoutes() {
        for (String route : new String[]{"home", "information", "talk?view=rooms", "meetups", "my", "app-install"})
            assertEquals(LaunchPolicy.ORIGIN + "/#" + route, LaunchPolicy.resolve(LaunchPolicy.ORIGIN + "/#" + route));
    }
    @Test public void rejectsExternalPrivateAndCredentialURLs() {
        for (String url : new String[]{null, "javascript:alert(1)", "https://evil.test/#information", "https://hiunni.kr.evil.test/#information", LaunchPolicy.ORIGIN+"/?token=secret#information", LaunchPolicy.ORIGIN+"/#talk/private-room", "http://hiunni.kr/#information", "https://user@hiunni.kr/#information"})
            assertEquals(LaunchPolicy.HOME, LaunchPolicy.resolve(url));
    }
}

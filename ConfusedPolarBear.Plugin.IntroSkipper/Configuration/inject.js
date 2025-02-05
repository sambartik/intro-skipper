let nowPlayingItemSkipSegments = {};
let videoPlayer = {};
let originalFetch = window.fetch;

function d(msg) {
    console.debug("[intro skipper]", msg);
}

/** Setup event listeners */
function setup() {
    document.addEventListener("viewshow", viewshow);
    window.fetch = fetchWrapper;
    d("Registered hooks");
}

/** Wrapper around fetch() that retrieves skip segments for the currently playing item. */
async function fetchWrapper(...args) {
    // Based on JellyScrub's trickplay.js
    let [resource, options] = args;
    let response = await originalFetch(resource, options);

    // Bail early if this isn't a playback info URL
    let path = new URL(resource).pathname;
    if (!path.includes("/PlaybackInfo")) {
        return response;
    }

    try
    {
        d("retrieving skip segments from URL");
        d(path);

        let id = path.split("/")[2];
        nowPlayingItemSkipSegments = await authenticatedFetch(`Episode/${id}/IntroTimestamps/v1`);

        d("successfully retrieved skip segments");
        d(nowPlayingItemSkipSegments);
    }
    catch (e)
    {
        console.error("unable to get skip segments from", path, e);
    }

    return response;
}

/**
 * Event handler that runs whenever the current view changes.
 * Used to detect the start of video playback.
 */
function viewshow() {
    const location = window.location.hash;
    d("Location changed to " + location);

    if (location !== "#!/video") {
        d("Ignoring location change");
        return;
    }

    d("Adding button CSS and element");
    injectSkipButtonCss();
    injectSkipButtonElement();

    d("Hooking video timeupdate");
    videoPlayer = document.querySelector("video");
    videoPlayer.addEventListener("timeupdate", videoPositionChanged);
}

/**
 * Injects the CSS used by the skip intro button.
 * Calling this function is a no-op if the CSS has already been injected.
 */
function injectSkipButtonCss() {
    if (testElement("style#introSkipperCss"))
    {
        d("CSS already added");
        return;
    }

    d("Adding CSS");

    let styleElement = document.createElement("style");
    styleElement.id = "introSkipperCss";
    styleElement.innerText = `
    @media (hover:hover) and (pointer:fine) {
        #skipIntro .paper-icon-button-light:hover:not(:disabled) {
            color: black !important;
            background-color: rgba(47, 93, 98, 0) !important;
        }
    }

    #skipIntro.upNextContainer {
        width: unset;
    }

    #skipIntro {
        padding: 0 1px;
        position: absolute;
        right: 10em;
        bottom: 9em;
        background-color: rgba(25, 25, 25, 0.66);
        border: 1px solid;
        border-radius: 0px;
        display: inline-block;
        cursor: pointer;
        box-shadow: inset 0 0 0 0 #f9f9f9;
        -webkit-transition: ease-out 0.4s;
        -moz-transition: ease-out 0.4s;
        transition: ease-out 0.4s;
    }

    @media (max-width: 1080px) {
        #skipIntro {
            right: 10%;
        }
    }

    #skipIntro:hover {
        box-shadow: inset 400px 0 0 0 #f9f9f9;
        -webkit-transition: ease-in 1s;
        -moz-transition: ease-in 1s;
        transition: ease-in 1s;
    }
    `;
    document.querySelector("head").appendChild(styleElement);
}

/**
 * Inject the skip intro button into the video player.
 * Calling this function is a no-op if the CSS has already been injected.
 */
async function injectSkipButtonElement() {
    if (testElement(".btnSkipIntro")) {
        d("Button already added");
        return;
    }

    d("Adding button");

    let config = await authenticatedFetch("Intros/UserInterfaceConfiguration");
    if (!config.SkipButtonVisible) {
        d("Not adding button: not visible");
        return;
    }

    // Construct the skip button div
    const button = document.createElement("div");
    button.id = "skipIntro"
    button.classList.add("hide");
    button.addEventListener("click", skipIntro);
    button.innerHTML = `
    <button is="paper-icon-button-light" class="btnSkipIntro paper-icon-button-light">
        <span id="btnSkipIntroText"></span>
        <span class="material-icons skip_next"></span>
    </button>
    `;

    /*
    * Alternative workaround for #44. Jellyfin's video component registers a global click handler
    * (located at src/controllers/playback/video/index.js:1492) that pauses video playback unless
    * the clicked element has a parent with the class "videoOsdBottom" or "upNextContainer".
    */
    button.classList.add("upNextContainer");

    // Append the button to the video OSD
    let controls = document.querySelector("div#videoOsdPage");
    controls.appendChild(button);

    document.querySelector("#btnSkipIntroText").textContent = config.SkipButtonText;
}

/** Playback position changed, check if the skip button needs to be displayed. */
function videoPositionChanged() {
    // Ensure a skip segment was found.
    if (!nowPlayingItemSkipSegments?.Valid) {
        return;
    }

    const skipButton = document.querySelector("#skipIntro");
    if (!skipButton) {
        return;
    }

    const position = videoPlayer.currentTime;
    if (position >= nowPlayingItemSkipSegments.ShowSkipPromptAt &&
        position < nowPlayingItemSkipSegments.HideSkipPromptAt) {
            skipButton.classList.remove("hide");
            return;
        }

    skipButton.classList.add("hide");
}

/** Seeks to the end of the intro. */
function skipIntro(e) {
    d("Skipping intro");
    d(nowPlayingItemSkipSegments);
    videoPlayer.currentTime = nowPlayingItemSkipSegments.IntroEnd;
}

/** Tests if an element with the provided selector exists. */
function testElement(selector) { return document.querySelector(selector); }

/** Make an authenticated fetch to the Jellyfin server and parse the response body as JSON. */
async function authenticatedFetch(url) {
    url = ApiClient.serverAddress() + "/" + url;

    const reqInit = {
        headers: {
            "Authorization": "MediaBrowser Token=" + ApiClient.accessToken()
        }
    };

    const res = await fetch(url, reqInit);

    if (res.status !== 200) {
        throw new Error(`Expected status 200 from ${url}, but got ${res.status}`);
    }

    return await res.json();
}

setup();

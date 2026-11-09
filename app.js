// Supabase provides shared authentication and persistent multi-user storage.
// Configure these two values in supabase-config.js before deploying.
const SUPABASE_URL = window.FLATMATE_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.FLATMATE_SUPABASE_ANON_KEY;
// Create the Supabase client only after validating its configuration. An invalid
// placeholder URL must never stop the login/register UI from attaching handlers.
let supabaseClient = null;
let supabaseReady = false;
let matchingReady = false;

async function initialiseSupabase() {
  if (supabaseReady && supabaseClient) return supabaseClient;
  if (!window.supabase?.createClient) {
    throw new Error("Supabase library could not load. Check your internet connection and refresh the page.");
  }
  if (!SUPABASE_URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL.trim())) {
    throw new Error("Your Supabase Project URL is missing or invalid. Update supabase-config.js.");
  }
  if (!SUPABASE_ANON_KEY || /YOUR_|PLACEHOLDER/i.test(SUPABASE_ANON_KEY)) {
    throw new Error("Your Supabase Publishable key is missing. Update supabase-config.js.");
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim());
    supabaseReady = true;
    return supabaseClient;
  } catch (error) {
    throw new Error(`Could not initialize Supabase: ${error.message}`);
  }
}

async function initialiseMatching() {
  await initialiseSupabase();
  if (matchingReady) return;
  if (typeof window.createMatchingModule !== "function") {
    throw new Error("The C++ matching module is missing. Check that Netlify generated matching.js and matching.wasm.");
  }
  matchingModule = await window.createMatchingModule();
  const response = await fetch("/demo_profiles.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load demo_profiles.json (HTTP ${response.status}).`);
  demoProfiles = await response.json();
  if (!Array.isArray(demoProfiles) || demoProfiles.length !== 100) {
    throw new Error(`Expected exactly 100 demo profiles, but found ${Array.isArray(demoProfiles) ? demoProfiles.length : 0}.`);
  }
  matchingReady = true;
}

// Shared UI state and helpers used throughout this file.
const $ = (id) => document.getElementById(id);
let authMode = "login";
let currentUser = null;
let currentStep = 1;
let currentMatches = [];
let matchingModule = null;
let demoProfiles = [];
let toastTimer = null;

function showScreen(name) {
  const screenId = `${name}Screen`;
  document.querySelectorAll(".screen").forEach(screen => {
    screen.hidden = screen.id !== screenId;
  });
  const authenticated = name !== "auth" && !!currentUser;
  $("bottomNav").hidden = !authenticated;
  $("topActions").hidden = !authenticated;
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.screen === name);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(message) {
  const element = $("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3000);
}

async function initialiseBackend() {
  // Kept as a compatibility wrapper for any existing call sites.
  await initialiseSupabase();
}

function publicProfile(row) {
  return {
    id: row.id, name: row.name, email: "", bio: row.bio || "",
    preferences: row.preferences || {}, hasProfile: !!row.has_profile,
    alreadyLiked: false
  };
}

async function api(path, options = {}) {
  await initialiseSupabase();
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  let result;

  if (path === "/register" && method === "POST") {
    const { data, error } = await supabaseClient.auth.signUp({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      options: { data: { full_name: body.name.trim() } }
    });
    if (error) throw error;
    if (!data.session) {
      // FlatMate is configured for immediate email/password access. Supabase
      // returns no session when the project's Confirm Email setting is enabled.
      // Do not display a misleading "check your email" flow: tell the owner
      // which project setting must be changed instead.
      throw new Error("Email confirmation is still enabled in Supabase. In your Supabase dashboard, open Authentication → Sign In / Providers → Email, turn off Confirm email, and save. Then confirm or recreate any account that was registered before this setting was changed.");
    }
    const user = data.user;
    const { data: profile, error: profileError } = await supabaseClient.from("profiles").upsert({
      id: user.id, name: body.name.trim(), bio: "", preferences: {}, has_profile: false
    }).select().single();
    if (profileError) throw profileError;
    return { message: "Account created", user: publicProfile(profile) };
  }

  if (path === "/login" && method === "POST") {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: body.email.trim().toLowerCase(), password: body.password
    });
    if (error) throw error;
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      const name = data.user.user_metadata?.full_name || data.user.email.split("@")[0];
      const { data: created, error: createError } = await supabaseClient.from("profiles")
        .insert({ id: data.user.id, name, bio: "", preferences: {}, has_profile: false })
        .select().single();
      if (createError) throw createError;
      return { user: publicProfile(created) };
    }
    return { user: publicProfile(profile) };
  }

  const profileMatch = path.match(/^\/users\/([^/]+)\/profile$/);
  if (profileMatch && method === "GET") {
    const { data, error } = await supabaseClient.from("profiles").select("*").eq("id", profileMatch[1]).single();
    if (error) throw error;
    return { user: publicProfile(data) };
  }
  if (profileMatch && method === "PUT") {
    const { data, error } = await supabaseClient.from("profiles").update({
      bio: body.bio || "", preferences: body.preferences, has_profile: true
    }).eq("id", profileMatch[1]).select().single();
    if (error) throw error;
    return { message: "Profile saved", user: publicProfile(data) };
  }

  const discoverMatch = path.match(/^\/users\/([^/]+)\/discover$/);
  if (discoverMatch && method === "GET") {
    await initialiseMatching();
    const uid = discoverMatch[1];
    const { data: own, error: ownError } = await supabaseClient.from("profiles")
      .select("*").eq("id", uid).single();
    if (ownError) throw ownError;
    if (!own.has_profile) throw new Error("Please complete your questionnaire first.");
    const { data: registered, error: usersError } = await supabaseClient.from("profiles")
      .select("*").eq("has_profile", true).neq("id", uid);
    if (usersError) throw usersError;
    const { data: likes, error: likesError } = await supabaseClient.from("likes")
      .select("target_id").eq("user_id", uid);
    if (likesError) throw likesError;
    const liked = new Set((likes || []).map(x => String(x.target_id)));
    const candidates = [
      ...demoProfiles.map(p => ({...p, id: String(p.id), alreadyLiked: liked.has(String(p.id))})),
      ...(registered || []).map(p => ({...publicProfile(p), alreadyLiked: liked.has(String(p.id))}))
    ].filter(p => String(p.id) !== uid);
    const ranked = JSON.parse(matchingModule.rankMatches(
      JSON.stringify(own.preferences), JSON.stringify(candidates)
    ));
    ranked.forEach(p => p.alreadyLiked = liked.has(String(p.id)));
    return { matches: ranked };
  }

  const likeMatch = path.match(/^\/users\/([^/]+)\/like\/([^/]+)$/);
  if (likeMatch && method === "POST") {
    const [, uid, targetId] = likeMatch;
    const { error } = await supabaseClient.from("likes").upsert(
      { user_id: uid, target_id: targetId }, { onConflict: "user_id,target_id", ignoreDuplicates: true }
    );
    if (error) throw error;
    return { message: "Profile saved to your Matches.", mutualMatch: false };
  }

  const matchesMatch = path.match(/^\/users\/([^/]+)\/matches$/);
  if (matchesMatch && method === "GET") {
    const uid = matchesMatch[1];
    const { data: likes, error } = await supabaseClient.from("likes").select("target_id").eq("user_id", uid);
    if (error) throw error;
    const ids = new Set((likes || []).map(x => String(x.target_id)));
    const demo = demoProfiles.filter(p => ids.has(String(p.id))).map(p => ({...p, id:String(p.id)}));
    const registeredIds = [...ids].filter(id => !/^\d+$/.test(id));
    let registered = [];
    if (registeredIds.length) {
      const { data, error: usersError } = await supabaseClient.from("profiles")
        .select("*").in("id", registeredIds);
      if (usersError) throw usersError;
      registered = data || [];
    }
    return { matches: [...demo, ...registered.map(publicProfile)] };
  }
  throw new Error(`Unsupported FlatMate request: ${method} ${path}`);
}

function photoKey(id=currentUser?.id) { return `flatmate_profile_photo_${id}`; }
function getPhoto(id=currentUser?.id) { try { return id ? localStorage.getItem(photoKey(id)) || "" : ""; } catch (_) { return ""; } }
function renderAccountAvatar() {
  const el=$("accountAvatar"); if(!el || !currentUser) return;
  const photo=getPhoto();
  if(photo){el.innerHTML=`<img src="${photo}" alt="Profile photo">`;el.classList.add("has-photo");}
  else{el.textContent=initials(currentUser.name);el.classList.remove("has-photo");}
}
function renderPhotoPreview() {
  if(!currentUser) return;
  const photo=getPhoto(), preview=$("profilePhotoPreview");
  preview.innerHTML=photo?`<img src="${photo}" alt="Profile photo preview">`:"Your photo";
  preview.classList.toggle("has-photo",!!photo);
  $("removeProfilePhoto").hidden=!photo;
  renderAccountAvatar();
}
function setupPhotoUpload() {
  const input=$("profilePhotoInput"); if(!input || input.dataset.bound) return;
  input.dataset.bound="true";
  input.addEventListener("change",()=>{
    const file=input.files?.[0]; if(!file) return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){toast("Choose a JPG, PNG or WebP image.");input.value="";return;}
    if(file.size>3*1024*1024){toast("Photo must be 3 MB or smaller.");input.value="";return;}
    const reader=new FileReader();
    reader.onload=()=>{try{localStorage.setItem(photoKey(),String(reader.result));renderPhotoPreview();toast("Profile photo saved in this browser.");}catch(_){toast("Could not save the photo. Try a smaller image.");}};
    reader.readAsDataURL(file);
  });
  $("removeProfilePhoto").addEventListener("click",()=>{localStorage.removeItem(photoKey());input.value="";renderPhotoPreview();toast("Profile photo removed.");});
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.auth === mode));
  $("registerNameWrap").hidden = mode !== "register";
  $("authName").required = mode === "register";
  $("authPassword").autocomplete = mode === "register" ? "new-password" : "current-password";
  $("authSubmit").innerHTML = mode === "register" ? 'Create account <span>→</span>' : 'Log in <span>→</span>';
  $("authError").textContent = "";
}

async function enterApp(user) {
  currentUser = user;
  $("welcomeText").textContent = `Hello, ${(user.name || "there").split(" ")[0]}`;
  renderAccountAvatar(); renderPhotoPreview();
  try {
    const data = await api(`/users/${user.id}/profile`);
    currentUser = data.user;
    if (!currentUser.hasProfile) {
      populateQuestionnaire();
      showScreen("questionnaire");
    } else {
      await loadDiscover();
    }
  } catch (error) {
    console.error("Could not load the signed-in user's profile:", error);
    showScreen("auth");
    $("authError").textContent = `You are signed in, but your profile could not be loaded: ${error.message}. Check the Supabase profiles table and its Row Level Security policies.`;
  }
}

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = $("authError");
  const submitButton = $("authSubmit");
  errorBox.textContent = "";

  const payload = {
    email: $("authEmail").value.trim(),
    password: $("authPassword").value
  };
  if (!payload.email || !payload.password) {
    errorBox.textContent = "Enter your email address and password.";
    return;
  }
  if (authMode === "register") {
    payload.name = $("authName").value.trim();
    if (!payload.name) {
      errorBox.textContent = "Enter your name to create an account.";
      $("authName").focus();
      return;
    }
  }

  submitButton.disabled = true;
  const originalLabel = authMode === "register" ? 'Create account <span>→</span>' : 'Log in <span>→</span>';
  submitButton.textContent = authMode === "register" ? "Creating account…" : "Logging in…";
  try {
    const data = authMode === "register"
      ? await api("/register", { method: "POST", body: JSON.stringify(payload) })
      : await api("/login", { method: "POST", body: JSON.stringify(payload) });

    toast(authMode === "register" ? "Account created. Let's set up your profile." : "Welcome back!");
    await enterApp(data.user);
  } catch (error) {
    console.error("FlatMate authentication error:", error);
    errorBox.textContent = error.message || "Authentication failed. Please try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalLabel;
  }
});

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setAuthMode(t.dataset.auth)));
document.querySelectorAll(".demo-login").forEach(button => button.addEventListener("click", () => {
  $("authError").textContent = "Demo profiles are available in Discover after you create your own account. Please register or log in.";
}));

function getRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}
function setRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${CSS.escape(value || "")}"]`);
  if (input) input.checked = true;
}

function populateQuestionnaire() {
  const p = currentUser?.preferences || {};
  $("city").value = ["Nashik", "Pune", "Mumbai"].includes(p.city) ? p.city : "Pune";
  $("budget").value = p.budget || 12000;
  $("bio").value = currentUser?.bio || "";
  $("sleepTime").value = p.sleepTime || "23:00";
  $("wakeTime").value = p.wakeTime || "07:00";
  $("cleanliness").value = p.cleanliness || "Very clean";
  $("studyWork").value = p.studyWork || "Mostly evenings";
  $("smoking").value = p.smoking || "No";
  $("foodPreference").value = p.foodPreference || "Vegetarian";
  $("guests").value = p.guests || "Occasionally";
  setRadio("roomSharing", p.roomSharing || "Private room preferred");
  setRadio("socialLifestyle", p.socialLifestyle || "Quiet");
  const keywords = p.keywords || [];
  document.querySelectorAll("#keywordGrid input").forEach(c => c.checked = keywords.includes(c.value));
  currentStep = 1;
  updateStep();
  renderPhotoPreview();
}

function updateStep() {
  document.querySelectorAll(".step-panel").forEach(panel => panel.hidden = Number(panel.dataset.step) !== currentStep);
  $("progressText").textContent = `Step ${currentStep} of 3`;
  $("progressBar").style.width = `${currentStep / 3 * 100}%`;
  $("backStep").hidden = currentStep === 1;
  $("nextStep").hidden = currentStep === 3;
  $("saveProfile").hidden = currentStep !== 3;
  $("questionnaireError").textContent = "";
}

$("nextStep").addEventListener("click", () => {
  if (currentStep === 1 && (!$("city").value.trim() || Number($("budget").value) <= 0)) {
    $("questionnaireError").textContent = "Please enter your city and a valid monthly budget.";
    return;
  }
  currentStep = Math.min(3, currentStep + 1);
  updateStep();
});
$("backStep").addEventListener("click", () => { currentStep = Math.max(1, currentStep - 1); updateStep(); });

$("questionnaireForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("questionnaireError");
  const saveButton = $("saveProfile");
  error.textContent = "";

  // Validate explicitly because the questionnaire is split across hidden steps.
  if (!currentUser || !currentUser.id) {
    error.textContent = "Your login session is missing. Log in again and retry.";
    return;
  }
  if (!$("city").value.trim() || !Number.isFinite(Number($("budget").value)) || Number($("budget").value) <= 0) {
    error.textContent = "Please enter a city and a monthly budget greater than zero.";
    currentStep = 1; updateStep(); return;
  }
  if (!$("sleepTime").value || !$("wakeTime").value) {
    error.textContent = "Please select both your sleep time and wake-up time.";
    currentStep = 2; updateStep(); return;
  }

  const preferences = {
    city: $("city").value.trim(),
    budget: Number($("budget").value),
    sleepTime: $("sleepTime").value,
    wakeTime: $("wakeTime").value,
    cleanliness: $("cleanliness").value,
    socialLifestyle: getRadio("socialLifestyle") || "Quiet",
    smoking: $("smoking").value,
    foodPreference: $("foodPreference").value,
    guests: $("guests").value,
    studyWork: $("studyWork").value,
    roomSharing: getRadio("roomSharing") || "Private room preferred",
    keywords: [...document.querySelectorAll("#keywordGrid input:checked")].map(x => x.value)
  };

  saveButton.disabled = true;
  saveButton.innerHTML = 'Saving preferences…';
  try {
    const saved = await api(`/users/${currentUser.id}/profile`, {
      method:"PUT", body:JSON.stringify({bio:$("bio").value.trim(), preferences})
    });
    currentUser = saved.user;
    await loadDiscover();
  } catch(e) {
    error.textContent = e.message;
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = 'Find my flatmates <span>→</span>';
  }
});

function initials(name) {
  return name.split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function compatibilityColorClass(score){return score>=75?"compat-high":score>=45?"compat-medium":"compat-low";}
function matchCard(user, saved = false) {
  const p=user.preferences||{}, tags=(p.keywords||[]).slice(0,3).map(k=>`<span class="tag">${escapeHtml(k)}</span>`).join("");
  const score=user.compatibility??null;
  return `<article class="match-card" data-profile="${user.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(user.name)} profile">
    <div class="card-cover"><div class="profile-avatar">${escapeHtml(initials(user.name))}</div>${score!==null?`<div class="match-score">${score}% match</div>`:""}</div>
    <div class="card-content"><h3 class="person-name">${escapeHtml(user.name)}</h3>
    <div class="person-meta">⌖ ${escapeHtml(p.city||"Location not set")} &nbsp;·&nbsp; ₹${Number(p.budget||0).toLocaleString("en-IN")}/month</div>
    <p class="person-bio">${escapeHtml(user.bio||"Still writing their flatmate introduction.")}</p><div class="tags">${tags||'<span class="tag">New to FlatMate</span>'}</div>
    ${score!==null?`<div class="compatibility ${compatibilityColorClass(score)}"><div class="compat-head"><span>LIFESTYLE COMPATIBILITY</span><b>${score}%</b></div><div class="compat-bar"><span style="width:${score}%"></span></div></div>`:""}
    ${saved?'<div class="note-box"><span>♡</span><p>Saved profile.</p></div>':`<div class="card-actions"><button class="pass-btn" data-pass="${user.id}">Pass</button><button class="like-btn" data-like="${user.id}" ${user.alreadyLiked?"disabled":""}>${user.alreadyLiked?"♥ Liked":"♡ Like"}</button></div>`}
    <div class="view-hint">Click card to view full profile ↗</div></div></article>`;
}
function showProfile(user){
  const p=user.preferences||{};
  $("detailAvatar").textContent=initials(user.name);$("detailName").textContent=user.name;
  $("detailLocation").textContent=`${p.city||"Location not set"} · Budget ₹${Number(p.budget||0).toLocaleString("en-IN")}/month`;
  $("detailScore").textContent=`${user.compatibility??"—"}%`;
  $("detailBio").textContent=user.bio||"No introduction provided.";
  const rows=[["Usual sleep time",p.sleepTime],["Usual wake time",p.wakeTime],["Cleanliness",p.cleanliness],["Social lifestyle",p.socialLifestyle],["Smoking",p.smoking],["Food preference",p.foodPreference],["Guests",p.guests],["Study / work routine",p.studyWork],["Room preference",p.roomSharing],["Monthly budget",`₹${Number(p.budget||0).toLocaleString("en-IN")}`],["City",p.city],["Compatibility",user.compatibility==null?"Not calculated":`${user.compatibility}%`]];
  $("detailGrid").innerHTML=rows.map(([label,value])=>`<div class="detail-item"><small>${escapeHtml(label)}</small><b>${escapeHtml(value||"Not specified")}</b></div>`).join("");
  $("detailKeywords").innerHTML=(p.keywords||[]).map(k=>`<span class="tag">${escapeHtml(k)}</span>`).join("");
  $("detailLikeBtn").dataset.like=user.id;$("detailLikeBtn").disabled=!!user.alreadyLiked;
  $("detailLikeBtn").textContent=user.alreadyLiked?"♥ Already liked":"♡ Like this flatmate";
  $("profileModal").hidden=false;
}
function closeProfile(){$("profileModal").hidden=true;}
function attachCardEvents(users,saved=false){
  document.querySelectorAll("[data-like]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();likeUser(String(btn.dataset.like),btn);}));
  document.querySelectorAll("[data-pass]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();btn.closest(".match-card").remove();updateResultCount();}));
  document.querySelectorAll(".match-card[data-profile]").forEach(card=>{
    const open=()=>{const user=users.find(x=>x.id===String(card.dataset.profile));if(user)showProfile(user);};
    card.addEventListener("click",open);card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
  });
}

async function loadDiscover() {
  if (!currentUser || !currentUser.id) {
    showScreen("auth");
    return;
  }
  showScreen("discover");
  $("matchGrid").hidden = false;
  $("emptyState").hidden = true;
  $("resultCount").textContent = "Connecting to FlatMate…";
  $("matchGrid").innerHTML = '<p class="person-meta">Finding compatible flatmates...</p>';
  try {
    const data = await api(`/users/${currentUser.id}/discover`);
    currentMatches = Array.isArray(data.matches) ? data.matches : [];
    $("discoverSubtitle").textContent = "All demo profiles ranked from highest to lowest compatibility.";
    $("resultCount").textContent = `${currentMatches.length} potential ${currentMatches.length === 1 ? "flatmate" : "flatmates"} found`;
    $("matchGrid").innerHTML = currentMatches.map(u => matchCard(u)).join("");
    if (currentMatches.length === 0) {
      $("matchGrid").hidden = true;
      $("emptyState").hidden = false;
      $("emptyState").querySelector("p").textContent = "The C++ backend returned zero profiles. Check that demo_profiles.json contains 100 records and restart the backend.";
    } else {
      $("matchGrid").hidden = false;
      $("emptyState").hidden = true;
      attachCardEvents(currentMatches);
    }
  } catch(e) {
    currentMatches = [];
    $("resultCount").textContent = "Could not load flatmates";
    $("matchGrid").hidden = false;
    $("matchGrid").innerHTML = `<p class="form-error" role="alert">${escapeHtml(e.message)}</p>`;
  }
}
function updateResultCount() {
  const n = $("matchGrid").querySelectorAll(".match-card").length;
  $("resultCount").textContent = `${n} potential ${n === 1 ? "flatmate" : "flatmates"} shown`;
  $("emptyState").hidden = n !== 0;
}
async function likeUser(id, button) {
  button.disabled = true;
  try {
    const data = await api(`/users/${currentUser.id}/like/${id}`, {method:"POST",body:"{}"});
    button.textContent = "♥ Liked";
    const detail=$("detailLikeBtn"); if(detail && String(detail.dataset.like)===String(id)){detail.disabled=true;detail.textContent="♥ Already liked";}
    toast("Profile saved to your Matches.");
  } catch(e) {
    button.disabled = false;
    toast(e.message);
  }
}

async function loadMutualMatches() {
  showScreen("matches");
  try {
    const data = await api(`/users/${currentUser.id}/matches`);
    const list = data.matches || [];
    $("mutualGrid").innerHTML = list.map(u => matchCard(u, true)).join("");
    $("mutualGrid").hidden = list.length === 0;
    $("mutualEmpty").hidden = list.length !== 0;
    attachCardEvents(list,true);
  } catch(e) { toast(e.message); }
}

$("editProfileBtn").addEventListener("click", () => { populateQuestionnaire(); showScreen("questionnaire"); });
$("emptyEditBtn").addEventListener("click", () => { populateQuestionnaire(); showScreen("questionnaire"); });
$("backDiscoverBtn").addEventListener("click", loadDiscover);
$("logoutBtn").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  currentMatches = [];
  $("authForm").reset();
  setAuthMode("login");
  showScreen("auth");
  toast("You have logged out.");
});
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => {
  if (btn.dataset.screen === "discover") loadDiscover();
  if (btn.dataset.screen === "matches") loadMutualMatches();
  if (btn.dataset.screen === "questionnaire") { populateQuestionnaire(); showScreen("questionnaire"); }
}));

$("closeProfileModal").addEventListener("click",closeProfile);
$("detailCloseBtn").addEventListener("click",closeProfile);
document.querySelectorAll("[data-close-modal]").forEach(el=>el.addEventListener("click",closeProfile));
$("detailLikeBtn").addEventListener("click",()=>likeUser(String($("detailLikeBtn").dataset.like),$("detailLikeBtn")));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProfile();});
setupPhotoUpload();
showScreen("auth");
(async () => {
  // Authentication UI is already wired before this background session check.
  // A missing WASM file or demo dataset must not disable login or registration.
  try {
    await initialiseSupabase();
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (session?.user) {
      let { data: profile, error } = await supabaseClient.from("profiles")
        .select("*").eq("id", session.user.id).maybeSingle();
      if (error) throw error;
      if (!profile) {
        const name = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "FlatMate user";
        const result = await supabaseClient.from("profiles").upsert({
          id: session.user.id, name, bio: "", preferences: {}, has_profile: false
        }).select().single();
        if (result.error) throw result.error;
        profile = result.data;
      }
      await enterApp(publicProfile(profile));
    }
  } catch (error) {
    console.error("FlatMate startup error:", error);
    $("authError").textContent = error.message || "Could not restore your session. You can still try logging in.";
  }
})();

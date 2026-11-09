const API = "/api";
let authMode = "login";
let currentUser = null;
let currentStep = 1;
let currentMatches = [];

const $ = (id) => document.getElementById(id);
const screens = ["authScreen", "questionnaireScreen", "discoverScreen", "matchesScreen"];

function showScreen(name) {
  const map = {auth:"authScreen", questionnaire:"questionnaireScreen", discover:"discoverScreen", matches:"matchesScreen"};
  screens.forEach(id => $(id).hidden = id !== map[name]);
  $("bottomNav").hidden = !currentUser || name === "auth";
  $("topActions").hidden = !currentUser || name === "auth";
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  window.scrollTo({top:0, behavior:"smooth"});
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(API + path, {
      ...options,
      headers: {"Content-Type":"application/json", ...(options.headers || {})}
    });
  } catch (_) {
    throw new Error("Cannot reach the C++ backend. Start ./FlatMate in the project folder, then refresh this page.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Backend request failed (${response.status}).`);
  return data;
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
  $("welcomeText").textContent = `Hello, ${user.name.split(" ")[0]}`;
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
  } catch (e) {
    populateQuestionnaire();
    showScreen("questionnaire");
  }
}

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").textContent = "";
  const payload = {
    email: $("authEmail").value.trim(),
    password: $("authPassword").value
  };
  try {
    let data;
    if (authMode === "register") {
      payload.name = $("authName").value.trim();
      data = await api("/register", {method:"POST", body:JSON.stringify(payload)});
      toast("Account created. Let’s set up your profile.");
    } else {
      data = await api("/login", {method:"POST", body:JSON.stringify(payload)});
      toast("Welcome back!");
    }
    await enterApp(data.user);
  } catch (e) {
    $("authError").textContent = e.message;
  }
});

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setAuthMode(t.dataset.auth)));
document.querySelectorAll(".demo-login").forEach(button => button.addEventListener("click", async () => {
  try {
    const data = await api("/login", {method:"POST", body:JSON.stringify({email:button.dataset.email,password:"demo123"})});
    await enterApp(data.user);
  } catch(e) { $("authError").textContent = e.message; }
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
    await api(`/users/${currentUser.id}/profile`, {
      method:"PUT", body:JSON.stringify({bio:$("bio").value.trim(), preferences})
    });
    currentUser.preferences = preferences;
    currentUser.bio = $("bio").value.trim();
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
  document.querySelectorAll("[data-like]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();likeUser(Number(btn.dataset.like),btn);}));
  document.querySelectorAll("[data-pass]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();btn.closest(".match-card").remove();updateResultCount();}));
  document.querySelectorAll(".match-card[data-profile]").forEach(card=>{
    const open=()=>{const user=users.find(x=>x.id===Number(card.dataset.profile));if(user)showProfile(user);};
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
    const detail=$("detailLikeBtn"); if(detail && Number(detail.dataset.like)===id){detail.disabled=true;detail.textContent="♥ Already liked";}
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
$("logoutBtn").addEventListener("click", () => {
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
$("detailLikeBtn").addEventListener("click",()=>likeUser(Number($("detailLikeBtn").dataset.like),$("detailLikeBtn")));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProfile();});
setupPhotoUpload();
showScreen("auth");

/* =========================================================
   SNAPCIRCLE + FIREBASE
   Firebase Authentication + Cloud Firestore
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCSpI1K2-BaiX37sJ4EmngXp9KwKesjbtM",
  authDomain: "ratmir-590ab.firebaseapp.com",
  projectId: "ratmir-590ab",
  storageBucket: "ratmir-590ab.firebasestorage.app",
  messagingSenderId: "676017909815",
  appId: "1:676017909815:web:60d11f69b32b04b5a7cfb2",
  measurementId: "G-YWVEPE34M3",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* =========================================================
   STATE
   ========================================================= */

let currentUser = null; // username
let currentUid = null; // Firebase UID

let currentRoute = {
  name: "feed",
  param: null,
};

let profileTab = "posts";

let usersCache = {};
let postsCache = [];
let edgesCache = {};
let messagesCache = [];

let unsubscribeUsers = null;
let unsubscribePosts = null;
let unsubscribeEdges = null;
let unsubscribeMessages = null;

/* =========================================================
   HELPERS
   ========================================================= */

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");
}

const AVATAR_COLORS = [
  "#e1306c",
  "#833ab4",
  "#f6923d",
  "#3897f0",
  "#2ecc71",
  "#e67e22",
  "#9b59b6",
  "#16a085",
];

function avatarColor(username) {
  let h = 0;

  for (const c of username || "") {
    h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  }

  return AVATAR_COLORS[h];
}

function avatarHTML(username, name, size) {
  let cls = "avatar";

  if (size === "sm") {
    cls = "avatar avatar-sm";
  } else if (size === "lg") {
    cls = "avatar avatar-lg";
  }

  return `
    <div
      class="${cls}"
      style="background:${avatarColor(username)}"
    >
      ${initials(name)}
    </div>
  `;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.innerText = String(str ?? "");
  return div.innerHTML;
}

function timestampMs(value) {
  if (!value) return Date.now();

  if (typeof value === "number") {
    return value;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value.seconds) {
    return value.seconds * 1000;
  }

  return Date.now();
}

function timeAgo(value) {
  const time = timestampMs(value);
  const diff = Math.floor((Date.now() - time) / 1000);

  if (diff < 60) {
    return "только что";
  }

  if (diff < 3600) {
    return Math.floor(diff / 60) + " мин назад";
  }

  if (diff < 86400) {
    return Math.floor(diff / 3600) + " ч назад";
  }

  return Math.floor(diff / 86400) + " дн назад";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function firebaseErrorMessage(error) {
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use": "Такой логин уже занят",

    "auth/invalid-credential": "Неверный логин или пароль",

    "auth/invalid-login-credentials": "Неверный логин или пароль",

    "auth/wrong-password": "Неверный логин или пароль",

    "auth/user-not-found": "Неверный логин или пароль",

    "auth/weak-password": "Пароль должен содержать минимум 6 символов",

    "auth/too-many-requests": "Слишком много попыток. Попробуйте позже",

    "auth/network-request-failed": "Ошибка сети. Проверьте интернет",

    "auth/operation-not-allowed": "В Firebase не включён Email/Password",
  };

  return messages[code] || error?.message || "Произошла ошибка Firebase";
}

function findUserByUsername(username) {
  const normalized = String(username || "").toLowerCase();

  return (
    Object.values(usersCache).find((user) => user.username === normalized) ||
    null
  );
}

function findUserByUid(uid) {
  return usersCache[uid] || null;
}

function edgeKeyByUid(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

/* =========================================================
   FIREBASE SUBSCRIPTIONS
   ========================================================= */

function stopSubscriptions() {
  const unsubscribers = [
    unsubscribeUsers,
    unsubscribePosts,
    unsubscribeEdges,
    unsubscribeMessages,
  ];

  unsubscribers.forEach((unsub) => {
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (_) {}
    }
  });

  unsubscribeUsers = null;
  unsubscribePosts = null;
  unsubscribeEdges = null;
  unsubscribeMessages = null;
}

function startSubscriptions() {
  stopSubscriptions();

  /* ---------- USERS ---------- */

  unsubscribeUsers = db.collection("users").onSnapshot(
    (snapshot) => {
      const users = {};

      snapshot.forEach((doc) => {
        const data = doc.data() || {};

        users[doc.id] = {
          ...data,
          uid: data.uid || doc.id,
          username: String(data.username || "").toLowerCase(),
          name: data.name || data.username || "Пользователь",
          bio: data.bio || "",
        };
      });

      usersCache = users;

      renderAccountQuickList();
      refreshTopbarAvatar();

      if (currentUser) {
        render();
      }
    },

    (error) => {
      console.error("Users error:", error);
      showToast("Не удалось загрузить пользователей");
    },
  );

  /* ---------- POSTS ---------- */

  unsubscribePosts = db
    .collection("posts")
    .orderBy("createdAt", "desc")
    .limit(100)
    .onSnapshot(
      (snapshot) => {
        postsCache = snapshot.docs.map((doc) => {
          const data = doc.data();

          return {
            id: doc.id,
            ...data,
            author: data.authorUsername,
            ts: timestampMs(data.createdAt),
          };
        });

        if (currentUser) {
          render();
        }
      },

      async (error) => {
        console.error("Posts error:", error);

        /*
          Если Firebase попросит индекс,
          временно загружаем документы без orderBy.
        */
        if (error?.code === "failed-precondition") {
          try {
            const snapshot = await db.collection("posts").limit(100).get();

            postsCache = snapshot.docs
              .map((doc) => {
                const data = doc.data();

                return {
                  id: doc.id,
                  ...data,
                  author: data.authorUsername,
                  ts: timestampMs(data.createdAt),
                };
              })
              .sort((a, b) => b.ts - a.ts);

            render();
          } catch (e) {
            console.error(e);
          }
        }
      },
    );

  /* ---------- RELATIONSHIPS ---------- */

  unsubscribeEdges = db
    .collection("relationships")
    .where("participants", "array-contains", currentUid)
    .onSnapshot(
      (snapshot) => {
        const edges = {};

        snapshot.forEach((doc) => {
          edges[doc.id] = {
            id: doc.id,
            ...doc.data(),
          };
        });

        edgesCache = edges;

        if (currentUser) {
          render();
        }
      },

      (error) => {
        console.error("Relationships error:", error);
        showToast("Не удалось загрузить друзей");
      },
    );

  /* ---------- MESSAGES ---------- */

  unsubscribeMessages = db
    .collection("messages")
    .where("participants", "array-contains", currentUid)
    .onSnapshot(
      (snapshot) => {
        messagesCache = snapshot.docs
          .map((doc) => {
            const data = doc.data();

            return {
              id: doc.id,
              ...data,
              ts: timestampMs(data.createdAt),
            };
          })
          .sort((a, b) => a.ts - b.ts);

        refreshBadge();

        if (currentUser) {
          render();
        }
      },

      (error) => {
        console.error("Messages error:", error);
        showToast("Не удалось загрузить сообщения");
      },
    );
}

/* =========================================================
   FRIENDS
   ========================================================= */

function relStatus(username) {
  const other = findUserByUsername(username);

  if (!other) {
    return "none";
  }

  if (other.uid === currentUid) {
    return "self";
  }

  const edge = edgesCache[edgeKeyByUid(currentUid, other.uid)];

  if (!edge) {
    return "none";
  }

  if (edge.status === "friends") {
    return "friends";
  }

  if (edge.status === "pending") {
    if (edge.fromUid === currentUid) {
      return "pending-sent";
    }

    return "pending-incoming";
  }

  return "none";
}

async function sendRequest(username) {
  const other = findUserByUsername(username);

  if (!other || !currentUid || other.uid === currentUid) {
    return;
  }

  const id = edgeKeyByUid(currentUid, other.uid);

  const ref = db.collection("relationships").doc(id);

  try {
    const existing = await ref.get();

    if (existing.exists) {
      return;
    }

    await ref.set({
      participants: [currentUid, other.uid],

      fromUid: currentUid,
      toUid: other.uid,

      status: "pending",

      createdAt: firebase.firestore.FieldValue.serverTimestamp(),

      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    showToast("Запрос отправлен");
  } catch (error) {
    console.error(error);
    showToast(firebaseErrorMessage(error));
  }
}

async function acceptRequest(username) {
  const other = findUserByUsername(username);

  if (!other) return;

  const id = edgeKeyByUid(currentUid, other.uid);

  try {
    await db.collection("relationships").doc(id).update({
      status: "friends",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    showToast("Заявка принята");
  } catch (error) {
    console.error(error);
    showToast(firebaseErrorMessage(error));
  }
}

async function declineOrCancel(username) {
  const other = findUserByUsername(username);

  if (!other) return;

  const id = edgeKeyByUid(currentUid, other.uid);

  try {
    await db.collection("relationships").doc(id).delete();

    render();
  } catch (error) {
    console.error(error);
    showToast(firebaseErrorMessage(error));
  }
}

function friendsOf(username) {
  const user = findUserByUsername(username);

  if (!user) {
    return [];
  }

  const result = [];

  Object.values(edgesCache).forEach((edge) => {
    if (edge.status !== "friends") {
      return;
    }

    if (!Array.isArray(edge.participants) || edge.participants.length !== 2) {
      return;
    }

    if (!edge.participants.includes(user.uid)) {
      return;
    }

    const otherUid = edge.participants.find((uid) => uid !== user.uid);

    const other = findUserByUid(otherUid);

    if (other) {
      result.push(other.username);
    }
  });

  return result;
}

function incomingRequestsFor(username) {
  const user = findUserByUsername(username);

  if (!user) {
    return [];
  }

  const result = [];

  Object.values(edgesCache).forEach((edge) => {
    if (edge.status !== "pending") {
      return;
    }

    if (edge.toUid !== user.uid) {
      return;
    }

    const sender = findUserByUid(edge.fromUid);

    if (sender) {
      result.push(sender.username);
    }
  });

  return result;
}

/* =========================================================
   MESSAGES
   ========================================================= */

function conversationBetween(username1, username2) {
  const user1 = findUserByUsername(username1);

  const user2 = findUserByUsername(username2);

  if (!user1 || !user2) {
    return [];
  }

  return messagesCache
    .filter((message) => {
      return (
        (message.fromUid === user1.uid && message.toUid === user2.uid) ||
        (message.fromUid === user2.uid && message.toUid === user1.uid)
      );
    })
    .sort((a, b) => a.ts - b.ts);
}

async function sendMessage(username, text) {
  text = String(text || "").trim();

  if (!text) return;

  const other = findUserByUsername(username);

  if (!other) {
    showToast("Пользователь не найден");
    return;
  }

  if (relStatus(username) !== "friends") {
    showToast("Писать можно только друзьям");
    return;
  }

  try {
    await db.collection("messages").add({
      fromUid: currentUid,
      fromUsername: currentUser,

      toUid: other.uid,
      toUsername: other.username,

      participants: [currentUid, other.uid],

      text,

      read: false,

      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(error);
    showToast(firebaseErrorMessage(error));
  }
}

async function markConversationRead(username) {
  const other = findUserByUsername(username);

  if (!other) return;

  const unread = messagesCache.filter((message) => {
    return (
      message.fromUid === other.uid &&
      message.toUid === currentUid &&
      !message.read
    );
  });

  if (!unread.length) {
    return;
  }

  const batch = db.batch();

  unread.forEach((message) => {
    batch.update(
      db.collection("messages").doc(message.id),

      {
        read: true,
      },
    );
  });

  try {
    await batch.commit();
  } catch (error) {
    console.error("markConversationRead:", error);
  }
}

function unreadFrom(username) {
  const other = findUserByUsername(username);

  if (!other) {
    return 0;
  }

  return messagesCache.filter((message) => {
    return (
      message.fromUid === other.uid &&
      message.toUid === currentUid &&
      !message.read
    );
  }).length;
}

function totalUnreadMessages() {
  return messagesCache.filter((message) => {
    return message.toUid === currentUid && !message.read;
  }).length;
}

function lastMessageWith(username) {
  const conversation = conversationBetween(currentUser, username);

  if (!conversation.length) {
    return null;
  }

  return conversation[conversation.length - 1];
}

/* =========================================================
   AUTH
   ========================================================= */

function showAuthError(message) {
  const element = document.getElementById("auth-error");

  if (element) {
    element.textContent = message || "";
  }
}

function showLogin() {
  showAuthError("");

  const loginForm = document.getElementById("login-form");

  const registerForm = document.getElementById("register-form");

  loginForm?.classList.remove("hidden");
  registerForm?.classList.add("hidden");
}

function showRegister() {
  showAuthError("");

  const loginForm = document.getElementById("login-form");

  const registerForm = document.getElementById("register-form");

  loginForm?.classList.add("hidden");
  registerForm?.classList.remove("hidden");
}

/*
  Firebase Email/Password использует email.

  Чтобы не переделывать твой интерфейс,
  логин превращаем во внутренний email.
*/

function syntheticEmail(username) {
  return `${username}@snapcircle.app`;
}

/* ---------- REGISTER ---------- */

async function handleRegister() {
  const name = document.getElementById("reg-name")?.value.trim();

  const username = document
    .getElementById("reg-username")
    ?.value.trim()
    .toLowerCase();

  const password = document.getElementById("reg-password")?.value;

  showAuthError("");

  if (!name || !username || !password) {
    showAuthError("Заполните все поля");
    return;
  }

  if (!/^[a-z0-9_.]+$/.test(username)) {
    showAuthError('Логин: только латиница, цифры, "_" или "."');
    return;
  }

  if (password.length < 6) {
    showAuthError("Пароль должен содержать минимум 6 символов");
    return;
  }

  let credential = null;

  try {
    credential = await auth.createUserWithEmailAndPassword(
      syntheticEmail(username),
      password,
    );

    const firebaseUser = credential.user;

    await db.collection("users").doc(firebaseUser.uid).set({
      uid: firebaseUser.uid,

      username,

      usernameLower: username,

      name,

      bio: "",

      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    document.getElementById("login-username").value = username;

    document.getElementById("login-password").value = "";

    showToast("Аккаунт успешно создан");

    await auth.signOut();

    showLogin();
  } catch (error) {
    console.error("Registration error:", error);

    /*
      Если Auth создал пользователя,
      но Firestore не создал профиль,
      пробуем удалить Auth-пользователя.
    */

    if (credential?.user && error?.code !== "auth/email-already-in-use") {
      try {
        await credential.user.delete();
      } catch (_) {}
    }

    showAuthError(firebaseErrorMessage(error));
  }
}

/* ---------- LOGIN ---------- */

async function handleLogin() {
  const username = document
    .getElementById("login-username")
    ?.value.trim()
    .toLowerCase();

  const password = document.getElementById("login-password")?.value;

  showAuthError("");

  if (!username || !password) {
    showAuthError("Введите логин и пароль");
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(syntheticEmail(username), password);
  } catch (error) {
    console.error("Login error:", error);

    showAuthError(firebaseErrorMessage(error));
  }
}

/* =========================================================
   QUICK LOGIN
   ========================================================= */

function renderAccountQuickList() {
  const wrapper = document.getElementById("account-list");

  const box = document.getElementById("account-list-items");

  if (!wrapper || !box) {
    return;
  }

  const users = Object.values(usersCache)
    .filter((user) => user.username)
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 8);

  if (!users.length) {
    wrapper.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  wrapper.classList.remove("hidden");

  box.innerHTML = users
    .map((user) => {
      const username = escapeHTML(user.username);

      return `
        <div
          class="account-chip"
          onclick="quickLogin('${username}')"
        >
          ${avatarHTML(user.username, user.name, "sm")}

          <div>
            <div style="font-weight:600">
              ${escapeHTML(user.name)}
            </div>

            <div style="
              font-size:11px;
              color:var(--text-dim)
            ">
              @${username}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function quickLogin(username) {
  const input = document.getElementById("login-username");

  if (!input) return;

  input.value = username;

  document.getElementById("login-password")?.focus();
}

/* =========================================================
   TOPBAR / APP
   ========================================================= */

function refreshTopbarAvatar() {
  const user = findUserByUid(currentUid);

  const avatar = document.getElementById("topbar-avatar");

  if (!avatar || !user) {
    return;
  }

  avatar.innerHTML = avatarHTML(user.username, user.name);
}

async function logout() {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
  }
}

/* =========================================================
   ROUTING
   ========================================================= */

function navigate(name, param = null) {
  currentRoute = {
    name,
    param,
  };

  render();
}

function openMyProfile() {
  navigate("profile", currentUser);
}

function refreshBadge() {
  if (!currentUser) {
    return;
  }

  const requestCount = incomingRequestsFor(currentUser).length;

  const requestBadge = document.getElementById("req-badge");

  if (requestBadge) {
    if (requestCount > 0) {
      requestBadge.textContent = requestCount > 9 ? "9+" : requestCount;

      requestBadge.classList.remove("hidden");
    } else {
      requestBadge.classList.add("hidden");
    }
  }

  const messageCount = totalUnreadMessages();

  const messageBadge = document.getElementById("msg-badge");

  if (messageBadge) {
    if (messageCount > 0) {
      messageBadge.textContent = messageCount > 9 ? "9+" : messageCount;

      messageBadge.classList.remove("hidden");
    } else {
      messageBadge.classList.add("hidden");
    }
  }
}

function render() {
  if (!currentUser) {
    return;
  }

  refreshBadge();

  const container = document.getElementById("main-content");

  if (!container) {
    return;
  }

  switch (currentRoute.name) {
    case "feed":
      container.innerHTML = renderFeedPage();
      break;

    case "requests":
      container.innerHTML = renderRequestsPage();
      break;

    case "profile":
      container.innerHTML = renderProfilePage(currentRoute.param);
      break;

    case "messages":
      container.innerHTML = renderMessagesPage();
      break;

    case "chat":
      container.innerHTML = renderChatPage(currentRoute.param);
      break;

    default:
      container.innerHTML = renderFeedPage();
  }

  const results = document.getElementById("search-results");

  if (results) {
    results.classList.add("hidden");
  }

  if (currentRoute.name === "chat") {
    markConversationRead(currentRoute.param);

    setTimeout(scrollChatToBottom, 50);
  }
}

function scrollChatToBottom() {
  const chat = document.getElementById("chat-thread");

  if (chat) {
    chat.scrollTop = chat.scrollHeight;
  }
}

/* =========================================================
   FEED
   ========================================================= */

function renderFeedPage() {
  const me = findUserByUid(currentUid);

  if (!me) {
    return `
      <div class="panel empty-state">
        Загрузка профиля...
      </div>
    `;
  }

  const posts = postsCache.slice().sort((a, b) => b.ts - a.ts);

  const composer = `
    <div class="panel composer">

      <div class="composer-top">
        ${avatarHTML(me.username, me.name, "sm")}

        <div style="
          font-weight:600;
          font-size:13.5px;
        ">
          ${escapeHTML(me.name)}
        </div>
      </div>

      <textarea
        id="post-text"
        placeholder="Что у вас нового, ${escapeHTML(me.name.split(" ")[0])}?"
      ></textarea>

      <input
        class="field"
        id="post-image"
        placeholder="Ссылка на картинку (необязательно)"
      >

      <div class="composer-actions">
        <button
          class="btn-post"
          onclick="createPost()"
        >
          Опубликовать
        </button>
      </div>

    </div>
  `;

  if (!posts.length) {
    return `
      <div>
        ${composer}

        <div class="panel empty-state">
          <div class="big">📷</div>
          Пока нет постов.
          Опубликуйте первый!
        </div>
      </div>

      <div>
        ${renderSidebar()}
      </div>
    `;
  }

  const feedHTML = posts
    .map((post) => {
      const author = findUserByUsername(post.author);

      if (!author) {
        return "";
      }

      let imageHTML = "";

      if (post.image) {
        imageHTML = `
            <img
              class="post-img"
              src="${escapeHTML(post.image)}"
              onerror="
                this.outerHTML='<div class=&quot;img-fallback&quot;>Не удалось загрузить изображение</div>'
              "
            >
          `;
      }

      return `
          <div class="panel post">

            <div class="post-head">

              <a
                href="#"
                onclick="
                  navigate(
                    'profile',
                    '${escapeHTML(post.author)}'
                  );
                  return false;
                "
              >
                ${avatarHTML(author.username, author.name, "sm")}
              </a>

              <div class="who">

                <div class="name">
                  <a
                    href="#"
                    onclick="
                      navigate(
                        'profile',
                        '${escapeHTML(post.author)}'
                      );
                      return false;
                    "
                  >
                    ${escapeHTML(author.name)}
                  </a>
                </div>

                <div class="time">
                  ${timeAgo(post.ts)}
                </div>

              </div>

            </div>

            ${imageHTML}

            <div class="post-body">
              <div class="post-text">
                <span class="pname">
                  ${escapeHTML(author.name)}
                </span>
                ${escapeHTML(post.text)}
              </div>
            </div>

          </div>
        `;
    })
    .join("");

  return `
    <div>
      ${composer}
      ${feedHTML}
    </div>

    <div>
      ${renderSidebar()}
    </div>
  `;
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function renderSidebar() {
  const me = findUserByUid(currentUid);

  if (!me) {
    return "";
  }

  const friends = friendsOf(currentUser);

  const incoming = incomingRequestsFor(currentUser);

  const profileCard = `
    <div class="panel side-card">

      <div class="side-profile">

        ${avatarHTML(me.username, me.name, "lg")}

        <div>

          <div class="name">
            ${escapeHTML(me.name)}
          </div>

          <div class="sub">
            @${escapeHTML(me.username)}
          </div>

          <div class="sub">
            ${friends.length} друзей
          </div>

        </div>

      </div>

    </div>
  `;

  const requestsCard = `
    <div class="panel side-card">

      <div class="side-title">
        <span>Заявки в друзья</span>

        ${incoming.length ? `<span>${incoming.length}</span>` : ""}
      </div>

      ${
        !incoming.length
          ? `
            <div style="
              font-size:12.5px;
              color:var(--text-dim)
            ">
              Нет новых заявок
            </div>
          `
          : incoming
              .slice(0, 4)
              .map((username) => {
                const user = findUserByUsername(username);

                if (!user) {
                  return "";
                }

                return `
                  <div class="req-row">

                    ${avatarHTML(user.username, user.name, "sm")}

                    <div class="who">
                      ${escapeHTML(user.name)}
                    </div>

                    <div class="req-actions">

                      <button
                        class="btn-mini btn-accept"
                        onclick="
                          acceptRequest(
                            '${escapeHTML(username)}'
                          )
                        "
                      >
                        Принять
                      </button>

                      <button
                        class="btn-mini btn-decline"
                        onclick="
                          declineOrCancel(
                            '${escapeHTML(username)}'
                          );
                          showToast('Заявка отклонена')
                        "
                      >
                        ✕
                      </button>

                    </div>

                  </div>
                `;
              })
              .join("")
      }

      ${
        incoming.length > 4
          ? `
            <div style="
              margin-top:8px;
              text-align:center;
            ">
              <button
                class="switch-line"
                style="
                  background:none;
                  border:none;
                  color:var(--ok);
                  font-weight:600;
                  cursor:pointer;
                "
                onclick="
                  navigate('requests')
                "
              >
                Показать все
              </button>
            </div>
          `
          : ""
      }

    </div>
  `;

  const friendsCard = `
    <div class="panel side-card">

      <div class="side-title">
        <span>Друзья</span>
      </div>

      ${
        !friends.length
          ? `
            <div style="
              font-size:12.5px;
              color:var(--text-dim)
            ">
              Пока нет друзей
            </div>
          `
          : friends
              .slice(0, 6)
              .map((username) => {
                const user = findUserByUsername(username);

                if (!user) {
                  return "";
                }

                const unread = unreadFrom(username);

                return `
                  <div class="friend-row">

                    ${avatarHTML(user.username, user.name, "sm")}

                    <div class="who">
                      <a
                        href="#"
                        onclick="
                          navigate(
                            'profile',
                            '${escapeHTML(username)}'
                          );
                          return false;
                        "
                      >
                        ${escapeHTML(user.name)}
                      </a>
                    </div>

                    <button
                      class="icon-btn-sm"
                      title="Написать"
                      onclick="
                        navigate(
                          'chat',
                          '${escapeHTML(username)}'
                        )
                      "
                    >
                      ✉️

                      ${unread ? `<span class="dot"></span>` : ""}
                    </button>

                  </div>
                `;
              })
              .join("")
      }

      ${
        friends.length
          ? `
            <div style="
              margin-top:8px;
              text-align:center;
            ">
              <button
                class="switch-line"
                style="
                  background:none;
                  border:none;
                  color:var(--ok);
                  font-weight:600;
                  cursor:pointer;
                "
                onclick="
                  navigate('messages')
                "
              >
                Все сообщения
              </button>
            </div>
          `
          : ""
      }

    </div>
  `;

  return `
    ${profileCard}
    ${requestsCard}
    ${friendsCard}
  `;
}

/* =========================================================
   REQUESTS PAGE
   ========================================================= */

function renderRequestsPage() {
  const incoming = incomingRequestsFor(currentUser);

  return `
    <div
      class="panel side-card"
      style="
        grid-column:1/-1;
        max-width:600px;
        margin:0 auto;
      "
    >

      <button
        class="backbtn"
        onclick="navigate('feed')"
      >
        &larr; Назад в ленту
      </button>

      <div
        class="side-title"
        style="font-size:15px;"
      >
        Заявки в друзья
      </div>

      ${
        !incoming.length
          ? `
            <div class="empty-state">
              <div class="big">🤝</div>
              Нет входящих заявок
            </div>
          `
          : incoming
              .map((username) => {
                const user = findUserByUsername(username);

                if (!user) {
                  return "";
                }

                return `
                  <div class="req-row">

                    ${avatarHTML(user.username, user.name)}

                    <div class="who">

                      <div style="
                        font-weight:600
                      ">
                        ${escapeHTML(user.name)}
                      </div>

                      <div style="
                        font-size:12px;
                        color:var(--text-dim)
                      ">
                        @${escapeHTML(user.username)}
                      </div>

                    </div>

                    <div class="req-actions">

                      <button
                        class="btn-mini btn-accept"
                        onclick="
                          acceptRequest(
                            '${escapeHTML(username)}'
                          )
                        "
                      >
                        Принять
                      </button>

                      <button
                        class="btn-mini btn-decline"
                        onclick="
                          declineOrCancel(
                            '${escapeHTML(username)}'
                          );
                          showToast('Заявка отклонена')
                        "
                      >
                        Отклонить
                      </button>

                    </div>

                  </div>
                `;
              })
              .join("")
      }

    </div>
  `;
}

/* =========================================================
   PROFILE
   ========================================================= */

function renderProfilePage(username) {
  const user = findUserByUsername(username);

  if (!user) {
    return `
      <div class="panel empty-state">
        Пользователь не найден
      </div>
    `;
  }

  const isMe = user.uid === currentUid;

  const friends = friendsOf(user.username);

  const posts = postsCache
    .filter((post) => post.author === user.username)
    .sort((a, b) => b.ts - a.ts);

  const status = relStatus(user.username);

  let actions = "";

  if (!isMe) {
    if (status === "none") {
      actions = `
        <button
          class="btn-follow st-none"
          onclick="
            sendRequest(
              '${escapeHTML(user.username)}'
            )
          "
        >
          Отправить запрос
        </button>
      `;
    }

    if (status === "pending-sent") {
      actions = `
        <button
          class="btn-follow st-pending"
          onclick="
            declineOrCancel(
              '${escapeHTML(user.username)}'
            )
          "
        >
          Запрос отправлен ✕
        </button>
      `;
    }

    if (status === "pending-incoming") {
      actions = `
        <button
          class="btn-follow st-incoming"
          onclick="
            acceptRequest(
              '${escapeHTML(user.username)}'
            )
          "
        >
          Принять заявку
        </button>
      `;
    }

    if (status === "friends") {
      actions = `
        <button
          class="btn-follow st-friends"
          onclick="
            declineOrCancel(
              '${escapeHTML(user.username)}'
            )
          "
        >
          Друзья ✓
        </button>

        <button
          class="btn-follow"
          style="
            background:var(--ok);
            color:#fff;
          "
          onclick="
            navigate(
              'chat',
              '${escapeHTML(user.username)}'
            )
          "
        >
          Написать
        </button>
      `;
    }
  }

  const header = `
    <div class="panel profile-header">

      ${avatarHTML(user.username, user.name, "lg")}

      <div>

        <div class="profile-bio-name">
          ${escapeHTML(user.name)}

          <span style="
            color:var(--text-dim);
            font-weight:400;
            font-size:14px;
          ">
            @${escapeHTML(user.username)}
          </span>
        </div>

        ${
          user.bio
            ? `
              <div style="
                font-size:13px;
                color:var(--text-dim);
                max-width:400px;
              ">
                ${escapeHTML(user.bio)}
              </div>
            `
            : ""
        }

        <div class="profile-stats">

          <div>
            <b>${posts.length}</b>
            постов
          </div>

          <div>
            <b>${friends.length}</b>
            друзей
          </div>

        </div>

        <div style="
          margin-top:12px;
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        ">
          ${actions}
        </div>

      </div>

    </div>
  `;

  const postsHTML =
    posts.length === 0
      ? `
        <div class="empty-state">
          <div class="big">🗒️</div>
          Постов пока нет
        </div>
      `
      : posts
          .map(
            (post) => `
            <div class="panel post">

              <div class="post-head">

                ${avatarHTML(user.username, user.name, "sm")}

                <div class="who">

                  <div class="name">
                    ${escapeHTML(user.name)}
                  </div>

                  <div class="time">
                    ${timeAgo(post.ts)}
                  </div>

                </div>

              </div>

              ${
                post.image
                  ? `
                    <img
                      class="post-img"
                      src="${escapeHTML(post.image)}"
                    >
                  `
                  : ""
              }

              <div class="post-body">
                <div class="post-text">
                  ${escapeHTML(post.text)}
                </div>
              </div>

            </div>
          `,
          )
          .join("");

  const friendsHTML = !friends.length
    ? `
        <div class="empty-state">
          <div class="big">👥</div>
          Пока нет друзей
        </div>
      `
    : `
        <div class="panel side-card">

          ${friends
            .map((username) => {
              const friend = findUserByUsername(username);

              if (!friend) {
                return "";
              }

              return `
                  <div class="friend-row">

                    ${avatarHTML(friend.username, friend.name, "sm")}

                    <div class="who">

                      <a
                        href="#"
                        onclick="
                          navigate(
                            'profile',
                            '${escapeHTML(username)}'
                          );
                          return false;
                        "
                      >
                        ${escapeHTML(friend.name)}
                      </a>

                    </div>

                    ${
                      isMe
                        ? `
                          <button
                            class="icon-btn-sm"
                            title="Написать"
                            onclick="
                              navigate(
                                'chat',
                                '${escapeHTML(username)}'
                              )
                            "
                          >
                            ✉️
                          </button>
                        `
                        : ""
                    }

                  </div>
                `;
            })
            .join("")}

        </div>
      `;

  return `
    <div
      style="
        grid-column:1/-1;
        max-width:700px;
        margin:0 auto;
        width:100%;
      "
    >

      <button
        class="backbtn"
        onclick="navigate('feed')"
      >
        &larr; Назад в ленту
      </button>

      ${header}

      <div
        class="panel"
        style="margin-top:16px;"
      >

        <div class="tab-row">

          <button
            class="tab-btn ${profileTab === "posts" ? "active" : ""}"
            onclick="
              profileTab='posts';
              render()
            "
          >
            ПОСТЫ
          </button>

          <button
            class="tab-btn ${profileTab === "friends" ? "active" : ""}"
            onclick="
              profileTab='friends';
              render()
            "
          >
            ДРУЗЬЯ
          </button>

        </div>

      </div>

      <div style="
        margin-top:16px;
      ">
        ${profileTab === "posts" ? postsHTML : friendsHTML}
      </div>

    </div>
  `;
}

/* =========================================================
   MESSAGES LIST
   ========================================================= */

function renderMessagesPage() {
  const friends = friendsOf(currentUser);

  if (!friends.length) {
    return `
      <div
        class="panel empty-state"
        style="
          grid-column:1/-1;
          max-width:600px;
          margin:0 auto;
        "
      >

        <button
          class="backbtn"
          style="float:left;"
          onclick="navigate('feed')"
        >
          &larr; Назад
        </button>

        <div style="clear:both"></div>

        <div class="big">✉️</div>

        Переписываться можно только
        с друзьями.

      </div>
    `;
  }

  const rows = friends
    .map((username) => {
      const user = findUserByUsername(username);

      if (!user) {
        return null;
      }

      return {
        username,
        user,
        last: lastMessageWith(username),
        unread: unreadFrom(username),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0))
    .map((item) => {
      const preview = item.last
        ? (item.last.fromUid === currentUid ? "Вы: " : "") +
          escapeHTML(String(item.last.text || "").slice(0, 60))
        : `
              <span style="
                color:var(--text-dim)
              ">
                Нет сообщений —
                начните разговор
              </span>
            `;

      return `
          <div
            class="req-row"
            style="cursor:pointer;"
            onclick="
              navigate(
                'chat',
                '${escapeHTML(item.username)}'
              )
            "
          >

            ${avatarHTML(item.user.username, item.user.name)}

            <div class="who">

              <div style="
                font-weight:600;
              ">
                ${escapeHTML(item.user.name)}
              </div>

              <div style="
                font-size:12.5px;
                color:var(--text-dim);
              ">
                ${preview}
              </div>

            </div>

            ${
              item.unread
                ? `
                  <span
                    class="badge"
                    style="position:static;"
                  >
                    ${item.unread > 9 ? "9+" : item.unread}
                  </span>
                `
                : item.last
                  ? `
                    <div class="time">
                      ${timeAgo(item.last.ts)}
                    </div>
                  `
                  : ""
            }

          </div>
        `;
    })
    .join("");

  return `
    <div
      class="panel side-card"
      style="
        grid-column:1/-1;
        max-width:600px;
        margin:0 auto;
      "
    >

      <button
        class="backbtn"
        onclick="navigate('feed')"
      >
        &larr; Назад в ленту
      </button>

      <div
        class="side-title"
        style="font-size:15px;"
      >
        Сообщения
      </div>

      ${rows}

    </div>
  `;
}

/* =========================================================
   CHAT
   ========================================================= */

function renderChatPage(username) {
  const other = findUserByUsername(username);

  if (!other) {
    return `
      <div class="panel empty-state">
        Пользователь не найден
      </div>
    `;
  }

  if (relStatus(username) !== "friends") {
    return `
      <div
        class="panel empty-state"
        style="
          grid-column:1/-1;
          max-width:600px;
          margin:0 auto;
        "
      >

        <button
          class="backbtn"
          style="float:left;"
          onclick="navigate('feed')"
        >
          &larr; Назад
        </button>

        <div style="clear:both"></div>

        <div class="big">🔒</div>

        Писать можно только друзьям.

        Сначала добавьте
        ${escapeHTML(other.name)}
        в друзья.

      </div>
    `;
  }

  const conversation = conversationBetween(currentUser, username);

  let bubbles = "";

  if (!conversation.length) {
    bubbles = `
      <div class="empty-state">

        <div class="big">👋</div>

        Начните разговор
        с ${escapeHTML(other.name)}

      </div>
    `;
  } else {
    bubbles = conversation
      .map((message) => {
        const mine = message.fromUid === currentUid;

        return `
            <div
              class="msg-row ${mine ? "mine" : ""}"
            >

              ${!mine ? avatarHTML(other.username, other.name, "sm") : ""}

              <div
                class="msg-bubble ${mine ? "mine" : ""}"
              >

                <div>
                  ${escapeHTML(message.text)}
                </div>

                <div class="msg-time">
                  ${timeAgo(message.ts)}
                </div>

              </div>

            </div>
          `;
      })
      .join("");
  }

  return `
    <div
      class="panel chat-panel"
      style="
        grid-column:1/-1;
        max-width:640px;
        margin:0 auto;
        width:100%;
      "
    >

      <div class="chat-header">

        <button
          class="backbtn"
          onclick="navigate('messages')"
          style="margin:0;"
        >
          &larr;
        </button>

        <a
          href="#"
          onclick="
            navigate(
              'profile',
              '${escapeHTML(username)}'
            );
            return false;
          "
          style="
            display:flex;
            align-items:center;
            gap:10px;
          "
        >

          ${avatarHTML(other.username, other.name, "sm")}

          <span style="
            font-weight:600;
            font-size:14px;
          ">
            ${escapeHTML(other.name)}
          </span>

        </a>

      </div>

      <div
        id="chat-thread"
        class="chat-thread"
      >
        ${bubbles}
      </div>

      <div class="chat-input-row">

        <input
          class="field"
          id="chat-input"
          placeholder="Написать сообщение..."
          style="margin-bottom:0;"
          autocomplete="off"
        >

        <button
          class="btn-post"
          onclick="
            handleSendChat(
              '${escapeHTML(username)}'
            )
          "
        >
          Отправить
        </button>

      </div>

    </div>
  `;
}

async function handleSendChat(username) {
  const input = document.getElementById("chat-input");

  if (!input) {
    return;
  }

  const text = input.value.trim();

  if (!text) {
    return;
  }

  input.value = "";

  await sendMessage(username, text);

  setTimeout(scrollChatToBottom, 100);
}

/* =========================================================
   CREATE POST
   ========================================================= */

async function createPost() {
  const textElement = document.getElementById("post-text");

  const imageElement = document.getElementById("post-image");

  if (!textElement || !imageElement) {
    return;
  }

  const text = textElement.value.trim();

  const image = imageElement.value.trim();

  if (!text && !image) {
    showToast("Напишите текст или добавьте картинку");

    return;
  }

  try {
    await db.collection("posts").add({
      authorUid: currentUid,
      authorUsername: currentUser,

      text,

      image,

      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    textElement.value = "";
    imageElement.value = "";

    showToast("Пост опубликован");
  } catch (error) {
    console.error("createPost:", error);

    showToast(firebaseErrorMessage(error));
  }
}

/* =========================================================
   SEARCH
   ========================================================= */

function handleSearch() {
  const input = document.getElementById("search-input");

  const box = document.getElementById("search-results");

  if (!input || !box) {
    return;
  }

  const query = input.value.trim().toLowerCase();

  if (!query) {
    box.classList.add("hidden");

    box.innerHTML = "";

    return;
  }

  const matches = Object.values(usersCache)
    .filter((user) => {
      if (user.username === currentUser) {
        return false;
      }

      return (
        user.username.toLowerCase().includes(query) ||
        user.name.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 8);

  if (!matches.length) {
    box.innerHTML = `
      <div
        class="search-row"
        style="
          color:var(--text-dim);
          cursor:default;
        "
      >
        Никого не найдено
      </div>
    `;
  } else {
    box.innerHTML = matches
      .map(
        (user) => `
          <div
            class="search-row"
            onclick="
              goToProfileFromSearch(
                '${escapeHTML(user.username)}'
              )
            "
          >

            ${avatarHTML(user.username, user.name, "sm")}

            <div>

              <div style="
                font-weight:600;
                font-size:13px;
              ">
                ${escapeHTML(user.name)}
              </div>

              <div style="
                font-size:11.5px;
                color:var(--text-dim);
              ">
                @${escapeHTML(user.username)}
              </div>

            </div>

          </div>
        `,
      )
      .join("");
  }

  box.classList.remove("hidden");
}

function goToProfileFromSearch(username) {
  const input = document.getElementById("search-input");

  const box = document.getElementById("search-results");

  if (input) {
    input.value = "";
  }

  if (box) {
    box.classList.add("hidden");
  }

  navigate("profile", username);
}

/* =========================================================
   GLOBAL EVENTS
   ========================================================= */

document.addEventListener("click", (event) => {
  const wrapper = document.querySelector(".search-wrap");

  const results = document.getElementById("search-results");

  if (wrapper && results && !wrapper.contains(event.target)) {
    results.classList.add("hidden");
  }
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    event.target &&
    event.target.id === "chat-input" &&
    !event.shiftKey
  ) {
    event.preventDefault();

    if (currentRoute.name === "chat") {
      handleSendChat(currentRoute.param);
    }
  }
});

/* =========================================================
   FIREBASE AUTH STATE
   ========================================================= */

auth.onAuthStateChanged(async (firebaseUser) => {
  if (!firebaseUser) {
    stopSubscriptions();

    currentUser = null;
    currentUid = null;

    usersCache = {};
    postsCache = [];
    edgesCache = {};
    messagesCache = [];

    document.getElementById("main-screen")?.classList.add("hidden");

    document.getElementById("auth-screen")?.classList.remove("hidden");

    showLogin();

    return;
  }

  currentUid = firebaseUser.uid;

  try {
    const profile = await db.collection("users").doc(firebaseUser.uid).get();

    if (!profile.exists) {
      showAuthError("Профиль пользователя не найден");

      await auth.signOut();

      return;
    }

    const data = profile.data();

    usersCache[firebaseUser.uid] = {
      ...data,
      uid: firebaseUser.uid,

      username: String(data.username || "").toLowerCase(),

      name: data.name || "Пользователь",

      bio: data.bio || "",
    };

    currentUser = usersCache[firebaseUser.uid].username;

    document.getElementById("auth-screen")?.classList.add("hidden");

    document.getElementById("main-screen")?.classList.remove("hidden");

    startSubscriptions();

    currentRoute = {
      name: "feed",
      param: null,
    };

    refreshTopbarAvatar();

    render();
  } catch (error) {
    console.error("Auth bootstrap error:", error);

    showAuthError(
      "Не удалось загрузить профиль: " + firebaseErrorMessage(error),
    );

    await auth.signOut();
  }
});

/* =========================================================
   INIT
   ========================================================= */

(function init() {
  renderAccountQuickList();

  const loginUsername = document.getElementById("login-username");

  const loginPassword = document.getElementById("login-password");

  const registerPassword = document.getElementById("reg-password");

  const searchInput = document.getElementById("search-input");

  /* Login username */

  if (loginUsername) {
    loginUsername.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleLogin();
      }
    });
  }

  /* Login password */

  if (loginPassword) {
    loginPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleLogin();
      }
    });
  }

  /* Registration password */

  if (registerPassword) {
    registerPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleRegister();
      }
    });
  }

  /* Search */

  if (searchInput) {
    searchInput.addEventListener("input", handleSearch);

    searchInput.addEventListener("focus", handleSearch);
  }
})();

/* =============================================================
   HHST Swim Stats — Firebase initialization
   Compat SDK (script-tag style) so no bundler is needed.
   Load order (in HTML):
     1) firebase-app-compat.js
     2) firebase-firestore-compat.js
     3) firebase-auth-compat.js
     4) firebase-init.js   (this file)
     5) data.js
   ============================================================= */
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyDeoVYOe8cTQtL-VaroU5QxKpMgkScXprg",
    authDomain: "hhst-website.firebaseapp.com",
    projectId: "hhst-website",
    storageBucket: "hhst-website.firebasestorage.app",
    messagingSenderId: "217873882983",
    appId: "1:217873882983:web:823a036557f58f799d59c2",
    measurementId: "G-29M3EGZDMJ"
  };
  if(!firebase.apps.length){
    firebase.initializeApp(firebaseConfig);
  }
  window.FB = {
    db: firebase.firestore(),
    auth: firebase.auth(),
    FieldValue: firebase.firestore.FieldValue,
    Timestamp: firebase.firestore.Timestamp
  };
})();

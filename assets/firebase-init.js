/* =============================================================
   HHST Swim Stats — Firebase initialization
   Compat SDK (script-tag style) so no bundler is needed.
   Load order (in HTML):
     1) firebase-app-compat.js
     2) firebase-firestore-compat.js
     3) firebase-auth-compat.js
     4) firebase-init.js   (this file)
     5) data.js

   NOTE: This project now points at the shared "famsync-62653" Firebase
   project. The apiKey/appId below are taken from the iOS GoogleService-Info.plist
   in the FamSync repo. If web reads/writes fail with API-key restrictions,
   register a Web App in the famsync-62653 Firebase Console and paste the
   web config snippet here.
   ============================================================= */
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyBHwaV8_29TlEbI2Q9nr1QpSoUjWTaeRbY",
    authDomain: "famsync-62653.firebaseapp.com",
    projectId: "famsync-62653",
    storageBucket: "famsync-62653.firebasestorage.app",
    messagingSenderId: "764099433408",
    appId: "1:764099433408:web:10310e9a6c608e01a7ae25"
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

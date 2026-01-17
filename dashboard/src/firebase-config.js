// Firebase Configuration
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
    apiKey: "AIzaSyALNPxOu2AB7nFsoZ7EzYBwg3XyJ4xSl4k",
    authDomain: "clickdep-9768c.firebaseapp.com",
    projectId: "clickdep-9768c",
    storageBucket: "clickdep-9768c.firebasestorage.app",
    messagingSenderId: "774012672054",
    appId: "1:774012672054:web:0bb4430fd336cac2992097",
    measurementId: "G-9ZR8E762YF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Auth Functions
export async function signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle() {
    return signInWithPopup(auth, googleProvider);
}

export async function logOut() {
    return signOut(auth);
}

export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

export async function getIdToken() {
    const user = auth.currentUser;
    if (user) {
        return user.getIdToken();
    }
    return null;
}

export function getCurrentUser() {
    return auth.currentUser;
}

export { auth };

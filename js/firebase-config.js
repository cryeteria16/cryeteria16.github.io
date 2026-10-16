import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = { 
  apiKey: "AIzaSyBfRI1hugT-Wy5uJX47LNQU3wjM-VjnaC4", 
  authDomain: "cryeterialoginpage.firebaseapp.com", 
  projectId: "cryeterialoginpage" 
};

const app = initializeApp(firebaseConfig); 
export const auth = getAuth(app); 
export const db = getFirestore(app);
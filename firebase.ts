

// Standard Firebase Modular SDK initialization
import * as firebaseApp from 'firebase/app';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBCljwsTQ-PHm20VP-i8VByNrRwVFgMl5I",
  authDomain: "routing-4aab8.firebaseapp.com",
  databaseURL: "https://routing-4aab8-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "routing-4aab8",
  storageBucket: "routing-4aab8.firebasestorage.app",
  messagingSenderId: "148497920348",
  appId: "1:148497920348:web:0e14c31aa4dfde00205199"
};

const app = firebaseApp.initializeApp(firebaseConfig);

// Initialize Firestore with modern persistent cache settings
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
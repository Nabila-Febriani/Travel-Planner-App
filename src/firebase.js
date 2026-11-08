import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, remove, onValue, child } from 'firebase/database';

// ⚠️⚠️⚠️ GANTI DENGAN CONFIG KAMU DARI FIREBASE CONSOLE ⚠️⚠️⚠️
const firebaseConfig = {
  apiKey: "AIzaSyAAC2ugqKWnAhKEOQYdx7P3VJjMrTQLVQg",
  authDomain: "travel-planner-app-f2b91.firebaseapp.com",
  databaseURL: "https://travel-planner-app-f2b91-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "travel-planner-app-f2b91",
  storageBucket: "travel-planner-app-f2b91.firebasestorage.app",
  messagingSenderId: "319991546534",
  appId: "1:319991546534:web:d5b9e88cf79df7bc8c6a67"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Save trip data
export async function saveTrip(code, data) {
  try {
    await set(ref(db, 'trips/' + code), data);
    return true;
  } catch (e) {
    console.error('Failed to save trip:', e);
    return false;
  }
}

// Get trip data once
export async function getTrip(code) {
  try {
    const snap = await get(child(ref(db), 'trips/' + code));
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.error('Failed to get trip:', e);
    return null;
  }
}

// Delete trip from database
export async function deleteTrip(code) {
  try {
    await remove(ref(db, 'trips/' + code));
    return true;
  } catch (e) {
    console.error('Failed to delete trip:', e);
    return false;
  }
}

// List all trips in database (uses REST shallow query for compatibility with restrictive rules)
export async function listAllTrips() {
  try {
    const baseUrl = firebaseConfig.databaseURL.replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/trips.json?shallow=true`);
    const keys = await res.json();
    if (!keys || typeof keys !== "object") return [];
    const codes = Object.keys(keys);
    const trips = await Promise.all(codes.map(async (code) => {
      const trip = await getTrip(code);
      if (!trip) return null;
      return {
        code,
        name: trip.setup?.tripName || "Untitled",
        startDate: trip.setup?.startDate || "",
        endDate: trip.setup?.endDate || "",
        members: (trip.setup?.members || []).map(m => m.name).filter(Boolean),
      };
    }));
    return trips.filter(Boolean);
  } catch (e) {
    console.error('Failed to list trips:', e);
    return [];
  }
}

// Listen to trip changes (real-time)
export function listenTrip(code, callback) {
  const tripRef = ref(db, 'trips/' + code);
  const unsubscribe = onValue(tripRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  }, (error) => {
    console.error('Listen error:', error);
    callback(null);
  });
  return unsubscribe;
}
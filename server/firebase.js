// Firebase Admin SDK initialization + Firestore helpers
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let db;

function initFirebase() {
  if (admin.apps.length > 0) {
    db = admin.firestore();
    return db;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountPath) {
    const serviceAccount = require(path.resolve(serviceAccountPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId,
    });
  } else if (projectId) {
    // Application Default Credentials
    admin.initializeApp({ projectId });
  } else {
    console.warn('[Firebase] No credentials configured — running in offline mode.');
    return null;
  }

  db = admin.firestore();
  console.log(`[Firebase] Connected to project: ${projectId}`);
  return db;
}

// --- Firestore Helper Functions ---

async function getDoc(collection, id) {
  const doc = await db.collection(collection).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function setDoc(collection, id, data) {
  await db.collection(collection).doc(id).set(data, { merge: false });
  return { id, ...data };
}

async function updateDoc(collection, id, partial) {
  await db.collection(collection).doc(id).update(partial);
  const updated = await getDoc(collection, id);
  return updated;
}

async function deleteDoc(collection, id) {
  await db.collection(collection).doc(id).delete();
}

async function queryCollection(collection, filters = []) {
  let ref = db.collection(collection);
  for (const { field, op, value } of filters) {
    ref = ref.where(field, op, value);
  }
  const snapshot = await ref.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getAllDocs(collection) {
  const snapshot = await db.collection(collection).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
  initFirebase,
  getDb: () => db,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  getAllDocs,
};

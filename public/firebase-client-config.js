// Firebase Client SDK Configuration for Real-time Cart Sync
// This file initializes Firebase client SDK and provides helper functions for Firestore operations

let firebaseApp = null;
let firestoreDb = null;
let cartListenerUnsubscribe = null;
const cartBroadcastChannel = new BroadcastChannel('cart-sync-channel');

// Firebase web configuration
const firebaseConfig = {
    apiKey: "AIzaSyA0wUMqXS_Ig1ZVJkmnqGWj1kYOIaK9TWM",
    authDomain: "taste-juction-food-delivery.firebaseapp.com",
    databaseURL: "https://taste-juction-food-delivery-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "taste-juction-food-delivery",
    storageBucket: "taste-juction-food-delivery.firebasestorage.app",
    messagingSenderId: "1070448710680",
    appId: "1:1070448710680:web:8e0146efea7b79d22e1f6d",
    measurementId: "G-J0QPW1L3WG"
};

/**
 * Initialize Firebase Client SDK
 * Call this once when the page loads
 */
function initializeFirebaseClient() {
    if (firebaseApp) {
        console.log('[Firebase] Already initialized');
        return firebaseApp;
    }

    try {
        // Check if Firebase SDK is loaded
        if (typeof firebase === 'undefined') {
            console.error('[Firebase] Firebase SDK not loaded. Please include Firebase scripts in HTML.');
            return null;
        }

        // Initialize Firebase
        firebaseApp = firebase.initializeApp(firebaseConfig);
        firestoreDb = firebase.firestore();

        // Initialize Auth if available
        if (firebase.auth) {
            console.log('[Firebase] Auth initialized');
        }

        console.log('[Firebase] Client SDK initialized successfully');
        return firebaseApp;
    } catch (error) {
        console.error('[Firebase] Initialization error:', error);
        return null;
    }
}

/**
 * Get Firestore instance
 * @returns {firebase.firestore.Firestore|null}
 */
function getFirestoreInstance() {
    if (!firestoreDb) {
        initializeFirebaseClient();
    }
    return firestoreDb;
}

/**
 * Get Auth instance
 * @returns {firebase.auth.Auth|null}
 */
function getAuthInstance() {
    if (!firebaseApp) {
        initializeFirebaseClient();
    }
    return firebase.auth ? firebase.auth() : null;
}

/**
 * Setup real-time listener for cart changes
 * @param {string} email - User email
 * @param {function} callback - Callback function to handle cart updates
 * @returns {function|null} - Unsubscribe function
 */
function setupCartListener(email, callback) {
    if (!email) {
        console.warn('[Firebase] Cannot setup cart listener without email');
        return null;
    }

    const db = getFirestoreInstance();
    if (!db) {
        console.error('[Firebase] Firestore not initialized');
        return null;
    }

    // Cleanup existing listener if any
    if (cartListenerUnsubscribe) {
        cartListenerUnsubscribe();
        cartListenerUnsubscribe = null;
    }

    try {
        const cartDocRef = db.collection('carts').doc(email.toLowerCase());

        // Setup real-time listener
        cartListenerUnsubscribe = cartDocRef.onSnapshot(
            (doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    const cartData = data.cart || [];
                    console.log('[Firebase] Cart updated from Firestore:', cartData.length, 'items');

                    // Call the callback with updated cart
                    if (typeof callback === 'function') {
                        callback(cartData);
                    }
                } else {
                    console.log('[Firebase] Cart document does not exist, using empty cart');
                    if (typeof callback === 'function') {
                        callback([]);
                    }
                }
            },
            (error) => {
                console.error('[Firebase] Error in cart listener:', error);
            }
        );

        console.log('[Firebase] Cart listener setup for:', email);
        return cartListenerUnsubscribe;
    } catch (error) {
        console.error('[Firebase] Error setting up cart listener:', error);
        return null;
    }
}

/**
 * Save cart to Firestore
 * @param {string} email - User email
 * @param {Array} cart - Cart items array
 * @returns {Promise<boolean>}
 */
async function saveCartToFirestore(email, cart) {
    if (!email) {
        console.warn('[Firebase] Cannot save cart without email');
        return false;
    }

    const db = getFirestoreInstance();
    if (!db) {
        console.error('[Firebase] Firestore not initialized');
        return false;
    }

    try {
        const cartDocRef = db.collection('carts').doc(email.toLowerCase());
        await cartDocRef.set({
            cart: cart || [],
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log('[Firebase] Cart saved to Firestore:', cart.length, 'items');

        // Broadcast cart update to other tabs
        broadcastCartUpdate(cart);

        return true;
    } catch (error) {
        console.error('[Firebase] Error saving cart to Firestore:', error);
        return false;
    }
}

/**
 * Load cart from Firestore (one-time read)
 * @param {string} email - User email
 * @returns {Promise<Array>}
 */
async function loadCartFromFirestore(email) {
    if (!email) {
        console.warn('[Firebase] Cannot load cart without email');
        return [];
    }

    const db = getFirestoreInstance();
    if (!db) {
        console.error('[Firebase] Firestore not initialized');
        return [];
    }

    try {
        const cartDocRef = db.collection('carts').doc(email.toLowerCase());
        const doc = await cartDocRef.get();

        if (doc.exists) {
            const data = doc.data();
            const cartData = data.cart || [];
            console.log('[Firebase] Cart loaded from Firestore:', cartData.length, 'items');
            return cartData;
        } else {
            console.log('[Firebase] No cart found in Firestore');
            return [];
        }
    } catch (error) {
        console.error('[Firebase] Error loading cart from Firestore:', error);
        return [];
    }
}

/**
 * Clear cart from Firestore
 * @param {string} email - User email
 * @returns {Promise<boolean>}
 */
async function clearCartFromFirestore(email) {
    if (!email) {
        console.warn('[Firebase] Cannot clear cart without email');
        return false;
    }

    const db = getFirestoreInstance();
    if (!db) {
        console.error('[Firebase] Firestore not initialized');
        return false;
    }

    try {
        const cartDocRef = db.collection('carts').doc(email.toLowerCase());
        await cartDocRef.set({
            cart: [],
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log('[Firebase] Cart cleared from Firestore');

        // Broadcast cart clear to other tabs
        broadcastCartUpdate([]);

        return true;
    } catch (error) {
        console.error('[Firebase] Error clearing cart from Firestore:', error);
        return false;
    }
}

/**
 * Cleanup cart listener
 */
function cleanupCartListener() {
    if (cartListenerUnsubscribe) {
        cartListenerUnsubscribe();
        cartListenerUnsubscribe = null;
        console.log('[Firebase] Cart listener cleaned up');
    }
}

/**
 * Broadcast cart update to other tabs using BroadcastChannel
 * @param {Array} cart - Cart items
 */
function broadcastCartUpdate(cart) {
    try {
        cartBroadcastChannel.postMessage({
            type: 'CART_UPDATED',
            cart: cart,
            timestamp: Date.now()
        });
        console.log('[BroadcastChannel] Cart update broadcasted to other tabs');
    } catch (error) {
        console.error('[BroadcastChannel] Error broadcasting cart update:', error);
    }
}

/**
 * Listen for cart updates from other tabs
 * @param {function} callback - Callback to handle cart updates
 */
function listenToCartBroadcast(callback) {
    cartBroadcastChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'CART_UPDATED') {
            console.log('[BroadcastChannel] Received cart update from another tab');
            if (typeof callback === 'function') {
                callback(event.data.cart);
            }
        }
    };
}

// Initialize Firebase when this script loads
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebaseClient();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cleanupCartListener();
    cartBroadcastChannel.close();
});

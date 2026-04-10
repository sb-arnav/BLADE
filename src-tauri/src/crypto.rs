use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use rand::RngCore;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const SERVICE: &str = "blade-ai";
const KEY_NAME: &str = "encryption-key";
const NONCE_LEN: usize = 12;

/// Loads the encryption key from the OS keychain, or generates and stores a new one.
pub fn get_or_create_encryption_key() -> Result<Vec<u8>, String> {
    let entry =
        keyring::Entry::new(SERVICE, KEY_NAME).map_err(|e| format!("Keyring init error: {e}"))?;

    // Try to load existing key
    match entry.get_password() {
        Ok(b64_key) => {
            let key = base64::engine::general_purpose::STANDARD
                .decode(&b64_key)
                .map_err(|e| format!("Failed to decode key from keychain: {e}"))?;
            if key.len() != 32 {
                return Err(format!("Invalid key length in keychain: {}", key.len()));
            }
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            // Generate a new 32-byte key
            let mut key = vec![0u8; 32];
            OsRng.fill_bytes(&mut key);

            let b64_key = base64::engine::general_purpose::STANDARD.encode(&key);
            entry
                .set_password(&b64_key)
                .map_err(|e| format!("Failed to store key in keychain: {e}"))?;

            Ok(key)
        }
        Err(e) => Err(format!("Keyring error: {e}")),
    }
}

/// Encrypts plaintext with AES-256-GCM.
/// Returns base64(nonce || ciphertext_with_tag).
pub fn encrypt(plaintext: &str, key: &[u8]) -> Result<String, String> {
    if key.len() != 32 {
        return Err(format!("Invalid key length: {} (expected 32)", key.len()));
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init error: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    // Concatenate nonce + ciphertext (which includes the 16-byte auth tag)
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
}

/// Decrypts a base64-encoded ciphertext produced by `encrypt`.
pub fn decrypt(ciphertext_b64: &str, key: &[u8]) -> Result<String, String> {
    if key.len() != 32 {
        return Err(format!("Invalid key length: {} (expected 32)", key.len()));
    }

    let combined = base64::engine::general_purpose::STANDARD
        .decode(ciphertext_b64)
        .map_err(|e| format!("Base64 decode failed: {e}"))?;

    if combined.len() < NONCE_LEN + 16 {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init error: {e}"))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {e}"))
}

/// Convenience: encrypts using the keychain-managed key.
pub fn encrypt_value(plaintext: &str) -> Result<String, String> {
    let key = get_or_create_encryption_key()?;
    encrypt(plaintext, &key)
}

/// Convenience: decrypts using the keychain-managed key.
pub fn decrypt_value(ciphertext: &str) -> Result<String, String> {
    let key = get_or_create_encryption_key()?;
    decrypt(ciphertext, &key)
}

/// Heuristic check: returns true if text looks like base64-encoded ciphertext.
/// Requires valid base64 that decodes to at least nonce (12) + tag (16) + 1 byte.
pub fn is_encrypted(text: &str) -> bool {
    if text.len() < 40 {
        return false;
    }
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map(|bytes| bytes.len() > NONCE_LEN + 16)
        .unwrap_or(false)
}

/// Deterministic hash of a string, returned as a hex string.
/// Useful for generating stable IDs from content.
pub fn hash_id(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = vec![0xABu8; 32];
        let plaintext = "Hello, Blade!";
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_is_encrypted() {
        let key = vec![0xCDu8; 32];
        let encrypted = encrypt("test data", &key).unwrap();
        assert!(is_encrypted(&encrypted));
        assert!(!is_encrypted("just plain text"));
        assert!(!is_encrypted("short"));
    }

    #[test]
    fn test_hash_id_deterministic() {
        let a = hash_id("hello");
        let b = hash_id("hello");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn test_hash_id_different_inputs() {
        assert_ne!(hash_id("hello"), hash_id("world"));
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let key1 = vec![0x01u8; 32];
        let key2 = vec![0x02u8; 32];
        let encrypted = encrypt("secret", &key1).unwrap();
        assert!(decrypt(&encrypted, &key2).is_err());
    }

    #[test]
    fn test_invalid_key_length() {
        let short_key = vec![0u8; 16];
        assert!(encrypt("test", &short_key).is_err());
        assert!(decrypt("dGVzdA==", &short_key).is_err());
    }
}

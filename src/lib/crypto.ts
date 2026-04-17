// src/lib/crypto.ts
// Industry standard WebCrypto subset wrapper for Blade.
// Never roll your own crypto. Relies natively on window.crypto.subtle

export class CryptoUtil {
  /**
   * Generates a cryptographically strong UUID v4.
   */
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Universal SHA-256 string hasher for deriving cache keys or anonymizing data.
   */
  static async sha256(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * AES-GCM string encryption. 
   * Returns a base64 encoded payload: { iv, data }
   */
  static async encrypt(plainText: string, passwordString: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passwordString),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    
    // Use a static salt for simplicity here, in prod use dynamic per-item salt
    const salt = encoder.encode("blade-static-salt-v1");
    
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plainText)
    );

    const ivB64 = btoa(String.fromCharCode(...new Uint8Array(iv)));
    const dataB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
    
    return JSON.stringify({ iv: ivB64, data: dataB64 });
  }
}

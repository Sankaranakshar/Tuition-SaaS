import crypto from 'crypto';

// Ensure the key is exactly 32 bytes
let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (!encryptionKey) {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error("ENCRYPTION_KEY environment variable is required for secure token storage. Please set it in the Settings menu.");
    }
    if (key.length === 64) {
      encryptionKey = Buffer.from(key, 'hex');
    } else {
      // If it's a string, hash it to get 32 bytes
      encryptionKey = crypto.createHash('sha256').update(String(key)).digest();
    }
  }
  return encryptionKey;
}

const IV_LENGTH = 12; // For AES-GCM, 12 bytes is the standard IV length
const AUTH_TAG_LENGTH = 16; // 16 bytes is the standard tag length

export function encrypt(text: string) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encryptedText
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(text: string) {
  try {
    const key = getEncryptionKey();
    const [ivHex, authTagHex, encryptedHex] = text.split(':');
    
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error("Invalid encrypted text format");
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt token:", error);
    return null;
  }
}

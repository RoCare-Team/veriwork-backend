import crypto from 'crypto';

// Aadhaar numbers carry a Verhoeff checksum in their 12th digit. Validating it
// locally rejects typos and made-up numbers before anything reaches an admin.
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function normalizeAadhaarNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

export function isValidAadhaarNumber(value) {
  const digits = normalizeAadhaarNumber(value);
  if (digits.length !== 12) return false;
  // UIDAI never issues a number starting with 0 or 1.
  if (digits[0] === '0' || digits[0] === '1') return false;

  let checksum = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    checksum = D_TABLE[checksum][P_TABLE[i % 8][Number(reversed[i])]];
  }
  return checksum === 0;
}

export function maskAadhaarNumber(value) {
  const digits = normalizeAadhaarNumber(value);
  if (digits.length !== 12) return '';
  return `XXXX XXXX ${digits.slice(8)}`;
}

export function formatAadhaarNumber(value) {
  const digits = normalizeAadhaarNumber(value);
  if (digits.length !== 12) return digits;
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

// Deterministic hash so the same Aadhaar can't be claimed by two accounts,
// without ever storing the number in a searchable plain form.
export function hashAadhaarNumber(value) {
  const digits = normalizeAadhaarNumber(value);
  if (!digits) return '';
  return crypto.createHash('sha256').update(`aadhaar:${digits}`).digest('hex');
}

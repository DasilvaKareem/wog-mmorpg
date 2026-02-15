import { describe, it, expect } from 'vitest';
import {
  formatGoldToMetals,
  parseMetalsToGold,
  formatGoldString,
  parseGoldString,
  isValidMetalAmount,
} from './currency';

describe('Currency Utility Functions', () => {
  describe('formatGoldToMetals', () => {
    it('should convert 123.4567 GOLD to 123g 45s 67c', () => {
      const result = formatGoldToMetals(123.4567);
      expect(result.gold).toBe(123);
      expect(result.silver).toBe(45);
      expect(result.copper).toBe(67);
      expect(result.totalGold).toBe(123.4567);
    });

    it('should convert 1.0 GOLD to 1g 0s 0c', () => {
      const result = formatGoldToMetals(1.0);
      expect(result.gold).toBe(1);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(0);
    });

    it('should convert 0.0001 GOLD to 0g 0s 1c', () => {
      const result = formatGoldToMetals(0.0001);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(1);
    });

    it('should convert 0.01 GOLD to 0g 1s 0c', () => {
      const result = formatGoldToMetals(0.01);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(1);
      expect(result.copper).toBe(0);
    });

    it('should convert 10.0525 GOLD to 10g 5s 25c', () => {
      const result = formatGoldToMetals(10.0525);
      expect(result.gold).toBe(10);
      expect(result.silver).toBe(5);
      expect(result.copper).toBe(25);
    });

    it('should handle zero', () => {
      const result = formatGoldToMetals(0);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(0);
    });

    it('should handle large amounts', () => {
      const result = formatGoldToMetals(9999.9999);
      expect(result.gold).toBe(9999);
      expect(result.silver).toBe(99);
      expect(result.copper).toBe(99);
    });
  });

  describe('parseMetalsToGold', () => {
    it('should convert 10g 5s 25c to 10.0525 GOLD', () => {
      const result = parseMetalsToGold(10, 5, 25);
      expect(result).toBe(10.0525);
    });

    it('should convert 1g 0s 0c to 1.0 GOLD', () => {
      const result = parseMetalsToGold(1, 0, 0);
      expect(result).toBe(1.0);
    });

    it('should convert 0g 0s 1c to 0.0001 GOLD', () => {
      const result = parseMetalsToGold(0, 0, 1);
      expect(result).toBe(0.0001);
    });

    it('should convert 0g 1s 0c to 0.01 GOLD', () => {
      const result = parseMetalsToGold(0, 1, 0);
      expect(result).toBe(0.01);
    });

    it('should handle default parameters', () => {
      const result = parseMetalsToGold();
      expect(result).toBe(0);
    });

    it('should clamp silver above 99', () => {
      const result = parseMetalsToGold(1, 150, 0);
      expect(result).toBe(1.99); // Should cap at 99 silver
    });

    it('should clamp copper above 99', () => {
      const result = parseMetalsToGold(1, 0, 150);
      expect(result).toBe(1.0099); // Should cap at 99 copper
    });

    it('should handle negative values by clamping to 0', () => {
      const result = parseMetalsToGold(5, -10, -5);
      expect(result).toBe(5.0); // Negative values clamped to 0
    });
  });

  describe('formatGoldString', () => {
    it('should format 123.4567 as "123g 45s 67c"', () => {
      const result = formatGoldString(123.4567);
      expect(result).toBe('123g 45s 67c');
    });

    it('should format 10.05 as "10g 5s"', () => {
      const result = formatGoldString(10.05);
      expect(result).toBe('10g 5s');
    });

    it('should format 0.0025 as "25c"', () => {
      const result = formatGoldString(0.0025);
      expect(result).toBe('25c');
    });

    it('should format 100 as "100g"', () => {
      const result = formatGoldString(100);
      expect(result).toBe('100g');
    });

    it('should format 0 as "0c"', () => {
      const result = formatGoldString(0);
      expect(result).toBe('0c');
    });

    it('should format 1.0101 as "1g 1s 1c"', () => {
      const result = formatGoldString(1.0101);
      expect(result).toBe('1g 1s 1c');
    });
  });

  describe('parseGoldString', () => {
    it('should parse "10g 5s 25c" to 10.0525', () => {
      const result = parseGoldString('10g 5s 25c');
      expect(result).toBe(10.0525);
    });

    it('should parse "100g" to 100.0', () => {
      const result = parseGoldString('100g');
      expect(result).toBe(100.0);
    });

    it('should parse "50c" to 0.0050', () => {
      const result = parseGoldString('50c');
      expect(result).toBe(0.0050);
    });

    it('should parse "5s" to 0.05', () => {
      const result = parseGoldString('5s');
      expect(result).toBe(0.05);
    });

    it('should handle missing denominations', () => {
      const result = parseGoldString('10g 25c');
      expect(result).toBe(10.0025);
    });

    it('should handle empty string', () => {
      const result = parseGoldString('');
      expect(result).toBe(0);
    });

    it('should handle invalid string', () => {
      const result = parseGoldString('invalid');
      expect(result).toBe(0);
    });
  });

  describe('isValidMetalAmount', () => {
    it('should return true for valid amounts', () => {
      expect(isValidMetalAmount(100, 50, 25)).toBe(true);
      expect(isValidMetalAmount(0, 0, 0)).toBe(true);
      expect(isValidMetalAmount(1, 99, 99)).toBe(true);
    });

    it('should return false for invalid silver (> 99)', () => {
      expect(isValidMetalAmount(10, 100, 0)).toBe(false);
      expect(isValidMetalAmount(10, 150, 0)).toBe(false);
    });

    it('should return false for invalid copper (> 99)', () => {
      expect(isValidMetalAmount(10, 0, 100)).toBe(false);
      expect(isValidMetalAmount(10, 0, 200)).toBe(false);
    });

    it('should return false for negative values', () => {
      expect(isValidMetalAmount(-1, 0, 0)).toBe(false);
      expect(isValidMetalAmount(10, -5, 0)).toBe(false);
      expect(isValidMetalAmount(10, 0, -10)).toBe(false);
    });

    it('should return false for non-finite values', () => {
      expect(isValidMetalAmount(Infinity, 0, 0)).toBe(false);
      expect(isValidMetalAmount(10, NaN, 0)).toBe(false);
      expect(isValidMetalAmount(10, 0, Infinity)).toBe(false);
    });
  });

  describe('Round-trip conversions', () => {
    it('should preserve value through format and parse', () => {
      const original = 123.4567;
      const breakdown = formatGoldToMetals(original);
      const reconstructed = parseMetalsToGold(breakdown.gold, breakdown.silver, breakdown.copper);
      expect(reconstructed).toBeCloseTo(original, 4);
    });

    it('should preserve value through string format and parse', () => {
      const original = 10.0525;
      const formatted = formatGoldString(original);
      const parsed = parseGoldString(formatted);
      expect(parsed).toBe(original);
    });

    it('should handle precision correctly for small amounts', () => {
      const original = 0.0001;
      const breakdown = formatGoldToMetals(original);
      const reconstructed = parseMetalsToGold(breakdown.gold, breakdown.silver, breakdown.copper);
      expect(reconstructed).toBe(original);
    });
  });

  describe('Edge cases', () => {
    it('should handle very large gold amounts', () => {
      const result = formatGoldToMetals(999999.9999);
      expect(result.gold).toBe(999999);
      expect(result.silver).toBe(99);
      expect(result.copper).toBe(99);
    });

    it('should handle very small amounts correctly', () => {
      const result = formatGoldToMetals(0.0002);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(2);
    });

    it('should handle amounts that round to zero copper', () => {
      const result = formatGoldToMetals(0.00001); // Less than 1 copper
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(0);
    });

    it('should handle decimal precision issues', () => {
      // JavaScript floating point precision test
      const result = formatGoldToMetals(0.1 + 0.2); // Known JS precision issue
      expect(result.totalGold).toBeCloseTo(0.3, 10);
    });
  });
});

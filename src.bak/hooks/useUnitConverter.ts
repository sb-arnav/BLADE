import { useState, useCallback, useMemo } from "react";

/**
 * Unit Converter — convert between units of measurement.
 * Length, weight, temperature, time, data, speed, area, volume, pressure, energy.
 */

export interface UnitCategory {
  id: string;
  name: string;
  icon: string;
  units: Unit[];
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}

const CATEGORIES: UnitCategory[] = [
  {
    id: "length", name: "Length", icon: "📏",
    units: [
      { id: "mm", name: "Millimeter", symbol: "mm", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { id: "cm", name: "Centimeter", symbol: "cm", toBase: (v) => v / 100, fromBase: (v) => v * 100 },
      { id: "m", name: "Meter", symbol: "m", toBase: (v) => v, fromBase: (v) => v },
      { id: "km", name: "Kilometer", symbol: "km", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { id: "in", name: "Inch", symbol: "in", toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
      { id: "ft", name: "Foot", symbol: "ft", toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
      { id: "yd", name: "Yard", symbol: "yd", toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
      { id: "mi", name: "Mile", symbol: "mi", toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
      { id: "nm", name: "Nautical Mile", symbol: "nmi", toBase: (v) => v * 1852, fromBase: (v) => v / 1852 },
    ],
  },
  {
    id: "weight", name: "Weight", icon: "⚖️",
    units: [
      { id: "mg", name: "Milligram", symbol: "mg", toBase: (v) => v / 1000000, fromBase: (v) => v * 1000000 },
      { id: "g", name: "Gram", symbol: "g", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { id: "kg", name: "Kilogram", symbol: "kg", toBase: (v) => v, fromBase: (v) => v },
      { id: "t", name: "Metric Ton", symbol: "t", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { id: "oz", name: "Ounce", symbol: "oz", toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
      { id: "lb", name: "Pound", symbol: "lb", toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
      { id: "st", name: "Stone", symbol: "st", toBase: (v) => v * 6.35029, fromBase: (v) => v / 6.35029 },
    ],
  },
  {
    id: "temperature", name: "Temperature", icon: "🌡️",
    units: [
      { id: "c", name: "Celsius", symbol: "°C", toBase: (v) => v, fromBase: (v) => v },
      { id: "f", name: "Fahrenheit", symbol: "°F", toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
      { id: "k", name: "Kelvin", symbol: "K", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    ],
  },
  {
    id: "time", name: "Time", icon: "⏱️",
    units: [
      { id: "ms", name: "Millisecond", symbol: "ms", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { id: "s", name: "Second", symbol: "s", toBase: (v) => v, fromBase: (v) => v },
      { id: "min", name: "Minute", symbol: "min", toBase: (v) => v * 60, fromBase: (v) => v / 60 },
      { id: "hr", name: "Hour", symbol: "hr", toBase: (v) => v * 3600, fromBase: (v) => v / 3600 },
      { id: "day", name: "Day", symbol: "d", toBase: (v) => v * 86400, fromBase: (v) => v / 86400 },
      { id: "wk", name: "Week", symbol: "wk", toBase: (v) => v * 604800, fromBase: (v) => v / 604800 },
      { id: "mo", name: "Month (30d)", symbol: "mo", toBase: (v) => v * 2592000, fromBase: (v) => v / 2592000 },
      { id: "yr", name: "Year (365d)", symbol: "yr", toBase: (v) => v * 31536000, fromBase: (v) => v / 31536000 },
    ],
  },
  {
    id: "data", name: "Data", icon: "💾",
    units: [
      { id: "b", name: "Bit", symbol: "b", toBase: (v) => v / 8, fromBase: (v) => v * 8 },
      { id: "B", name: "Byte", symbol: "B", toBase: (v) => v, fromBase: (v) => v },
      { id: "KB", name: "Kilobyte", symbol: "KB", toBase: (v) => v * 1024, fromBase: (v) => v / 1024 },
      { id: "MB", name: "Megabyte", symbol: "MB", toBase: (v) => v * 1048576, fromBase: (v) => v / 1048576 },
      { id: "GB", name: "Gigabyte", symbol: "GB", toBase: (v) => v * 1073741824, fromBase: (v) => v / 1073741824 },
      { id: "TB", name: "Terabyte", symbol: "TB", toBase: (v) => v * 1099511627776, fromBase: (v) => v / 1099511627776 },
      { id: "PB", name: "Petabyte", symbol: "PB", toBase: (v) => v * 1125899906842624, fromBase: (v) => v / 1125899906842624 },
    ],
  },
  {
    id: "speed", name: "Speed", icon: "🏎️",
    units: [
      { id: "mps", name: "Meters/second", symbol: "m/s", toBase: (v) => v, fromBase: (v) => v },
      { id: "kph", name: "Kilometers/hour", symbol: "km/h", toBase: (v) => v / 3.6, fromBase: (v) => v * 3.6 },
      { id: "mph", name: "Miles/hour", symbol: "mph", toBase: (v) => v * 0.44704, fromBase: (v) => v / 0.44704 },
      { id: "kn", name: "Knots", symbol: "kn", toBase: (v) => v * 0.514444, fromBase: (v) => v / 0.514444 },
      { id: "fps", name: "Feet/second", symbol: "ft/s", toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
      { id: "mach", name: "Mach", symbol: "Mach", toBase: (v) => v * 343, fromBase: (v) => v / 343 },
      { id: "c", name: "Speed of light", symbol: "c", toBase: (v) => v * 299792458, fromBase: (v) => v / 299792458 },
    ],
  },
  {
    id: "area", name: "Area", icon: "📐",
    units: [
      { id: "mm2", name: "sq mm", symbol: "mm²", toBase: (v) => v / 1000000, fromBase: (v) => v * 1000000 },
      { id: "cm2", name: "sq cm", symbol: "cm²", toBase: (v) => v / 10000, fromBase: (v) => v * 10000 },
      { id: "m2", name: "sq meter", symbol: "m²", toBase: (v) => v, fromBase: (v) => v },
      { id: "km2", name: "sq km", symbol: "km²", toBase: (v) => v * 1000000, fromBase: (v) => v / 1000000 },
      { id: "in2", name: "sq inch", symbol: "in²", toBase: (v) => v * 0.00064516, fromBase: (v) => v / 0.00064516 },
      { id: "ft2", name: "sq foot", symbol: "ft²", toBase: (v) => v * 0.092903, fromBase: (v) => v / 0.092903 },
      { id: "ac", name: "Acre", symbol: "ac", toBase: (v) => v * 4046.86, fromBase: (v) => v / 4046.86 },
      { id: "ha", name: "Hectare", symbol: "ha", toBase: (v) => v * 10000, fromBase: (v) => v / 10000 },
    ],
  },
  {
    id: "volume", name: "Volume", icon: "🧊",
    units: [
      { id: "ml", name: "Milliliter", symbol: "mL", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { id: "l", name: "Liter", symbol: "L", toBase: (v) => v, fromBase: (v) => v },
      { id: "m3", name: "Cubic meter", symbol: "m³", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { id: "gal", name: "Gallon (US)", symbol: "gal", toBase: (v) => v * 3.78541, fromBase: (v) => v / 3.78541 },
      { id: "qt", name: "Quart (US)", symbol: "qt", toBase: (v) => v * 0.946353, fromBase: (v) => v / 0.946353 },
      { id: "pt", name: "Pint (US)", symbol: "pt", toBase: (v) => v * 0.473176, fromBase: (v) => v / 0.473176 },
      { id: "cup", name: "Cup (US)", symbol: "cup", toBase: (v) => v * 0.236588, fromBase: (v) => v / 0.236588 },
      { id: "floz", name: "Fluid oz (US)", symbol: "fl oz", toBase: (v) => v * 0.0295735, fromBase: (v) => v / 0.0295735 },
      { id: "tbsp", name: "Tablespoon", symbol: "tbsp", toBase: (v) => v * 0.0147868, fromBase: (v) => v / 0.0147868 },
      { id: "tsp", name: "Teaspoon", symbol: "tsp", toBase: (v) => v * 0.00492892, fromBase: (v) => v / 0.00492892 },
    ],
  },
  {
    id: "pressure", name: "Pressure", icon: "🔧",
    units: [
      { id: "pa", name: "Pascal", symbol: "Pa", toBase: (v) => v, fromBase: (v) => v },
      { id: "kpa", name: "Kilopascal", symbol: "kPa", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { id: "bar", name: "Bar", symbol: "bar", toBase: (v) => v * 100000, fromBase: (v) => v / 100000 },
      { id: "atm", name: "Atmosphere", symbol: "atm", toBase: (v) => v * 101325, fromBase: (v) => v / 101325 },
      { id: "psi", name: "PSI", symbol: "psi", toBase: (v) => v * 6894.76, fromBase: (v) => v / 6894.76 },
      { id: "mmhg", name: "mmHg", symbol: "mmHg", toBase: (v) => v * 133.322, fromBase: (v) => v / 133.322 },
    ],
  },
  {
    id: "energy", name: "Energy", icon: "⚡",
    units: [
      { id: "j", name: "Joule", symbol: "J", toBase: (v) => v, fromBase: (v) => v },
      { id: "kj", name: "Kilojoule", symbol: "kJ", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { id: "cal", name: "Calorie", symbol: "cal", toBase: (v) => v * 4.184, fromBase: (v) => v / 4.184 },
      { id: "kcal", name: "Kilocalorie", symbol: "kcal", toBase: (v) => v * 4184, fromBase: (v) => v / 4184 },
      { id: "wh", name: "Watt-hour", symbol: "Wh", toBase: (v) => v * 3600, fromBase: (v) => v / 3600 },
      { id: "kwh", name: "Kilowatt-hour", symbol: "kWh", toBase: (v) => v * 3600000, fromBase: (v) => v / 3600000 },
      { id: "ev", name: "Electron volt", symbol: "eV", toBase: (v) => v * 1.602e-19, fromBase: (v) => v / 1.602e-19 },
      { id: "btu", name: "BTU", symbol: "BTU", toBase: (v) => v * 1055.06, fromBase: (v) => v / 1055.06 },
    ],
  },
];

export function useUnitConverter() {
  const [categoryId, setCategoryId] = useState("length");
  const [fromUnitId, setFromUnitId] = useState("m");
  const [toUnitId, setToUnitId] = useState("ft");
  const [value, setValue] = useState("1");

  const category = useMemo(() => CATEGORIES.find((c) => c.id === categoryId) || CATEGORIES[0], [categoryId]);
  const fromUnit = useMemo(() => category.units.find((u) => u.id === fromUnitId) || category.units[0], [category, fromUnitId]);
  const toUnit = useMemo(() => category.units.find((u) => u.id === toUnitId) || category.units[1], [category, toUnitId]);

  const result = useMemo(() => {
    const num = parseFloat(value);
    if (isNaN(num)) return "";
    const base = fromUnit.toBase(num);
    const converted = toUnit.fromBase(base);
    // Format with appropriate precision
    if (Math.abs(converted) < 0.001 || Math.abs(converted) > 1000000) {
      return converted.toExponential(6);
    }
    return converted.toPrecision(10).replace(/\.?0+$/, "");
  }, [value, fromUnit, toUnit]);

  // Convert to all units in category
  const allConversions = useMemo(() => {
    const num = parseFloat(value);
    if (isNaN(num)) return [];
    const base = fromUnit.toBase(num);
    return category.units.map((u) => {
      const converted = u.fromBase(base);
      let formatted: string;
      if (Math.abs(converted) < 0.001 && converted !== 0) formatted = converted.toExponential(4);
      else if (Math.abs(converted) > 1000000) formatted = converted.toExponential(4);
      else formatted = converted.toPrecision(8).replace(/\.?0+$/, "");
      return { unit: u, value: formatted };
    });
  }, [value, fromUnit, category]);

  const swap = useCallback(() => {
    setFromUnitId(toUnitId);
    setToUnitId(fromUnitId);
    setValue(result || "1");
  }, [fromUnitId, toUnitId, result]);

  const setCategory = useCallback((id: string) => {
    const cat = CATEGORIES.find((c) => c.id === id);
    if (!cat) return;
    setCategoryId(id);
    setFromUnitId(cat.units[0].id);
    setToUnitId(cat.units.length > 1 ? cat.units[1].id : cat.units[0].id);
    setValue("1");
  }, []);

  return {
    categories: CATEGORIES,
    category,
    fromUnit,
    toUnit,
    value,
    result,
    allConversions,
    setValue,
    setFromUnit: setFromUnitId,
    setToUnit: setToUnitId,
    setCategory,
    swap,
  };
}

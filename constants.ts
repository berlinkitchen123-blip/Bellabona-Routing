import { Driver, Area } from './types';

export const DRIVERS: Driver[] = [
  // Sequence matches the image headers exactly
  { id: 'samir', name: 'Samir', level: 1, preferredArea: Area.KOEPENICK, capacity: 14, isActive: true },
  { id: 'ali2', name: 'Ali 2', level: 1, preferredArea: Area.PANKOW, capacity: 8, isActive: true },
  { id: 'josef', name: 'Jozef', level: 3, capacity: 8, isActive: true }, // Increased cap slightly to match visual volume
  { id: 'ali1', name: 'Ali 1', level: 3, capacity: 8, isActive: true },
  { id: 'ankush', name: 'Ankush', level: 2, capacity: 14, isActive: true },
  { id: 'harsh', name: 'Harsh', level: 4, capacity: 10, isActive: true },
  { id: 'packtor3', name: 'Packtor 3', level: 4, capacity: 7, isActive: true },
  { id: 'packator2', name: 'Packtor 2', level: 4, capacity: 7, isActive: true }, 
  { id: 'packator1', name: 'Packtor 1', level: 4, capacity: 7, isActive: true },
];

export const QUOTA_THRESHOLD = 88;
export const MIN_PACKATOR_STOPS = 4;
export const MIN_STOPS_EVERYFLEET = 4;

export const START_TIME_MINS = 630; // 10:30 AM in minutes from midnight
export const DEADLINE_MINS = 750;   // 12:30 PM in minutes from midnight

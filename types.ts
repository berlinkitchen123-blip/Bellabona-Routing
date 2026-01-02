
export enum Area {
  // Ali 2 / North
  PANKOW = 'Pankow',
  PRENZLAUER_BERG = 'Prenzlauer Berg',
  WEISSENSEE = 'Weissensee',
  REINICKENDORF = 'Reinickendorf',

  // Samir / South-East
  KOEPENICK = 'Köpenick',
  TREPTOW = 'Treptow',

  // Central (Mitte Split)
  MITTE_ZENTRUM = 'Mitte (Zentrum)',
  TIERGARTEN = 'Tiergarten',
  MOABIT = 'Moabit',
  WEDDING = 'Wedding',

  // West
  CHARLOTTENBURG = 'Charlottenburg',
  WILMERSDORF = 'Wilmersdorf',
  SPANDAU = 'Spandau',

  // East
  FRIEDRICHSHAIN = 'Friedrichshain',
  LICHTENBERG = 'Lichtenberg',
  MARZAHN = 'Marzahn',
  HELLERSDORF = 'Hellersdorf',

  // South / South-West
  KREUZBERG = 'Kreuzberg',
  NEUKOELLN = 'Neukölln',
  SCHOENEBERG = 'Schöneberg',
  TEMPELHOF = 'Tempelhof',
  STEGLITZ = 'Steglitz',
  ZEHLENDORF = 'Zehlendorf',

  OTHER = 'Other'
}

export enum BoxStatus {
  PENDING = 'Pending',
  COLLECTED = 'Collected'
}

export interface Company {
  companyId: string;
  name: string;
  address: string;
  postCode?: string;
  area: Area;
  fixedDeliveryTime: string;
  eatingTime?: string;
  boxStatus: BoxStatus;
  lat?: number;
  lng?: number;
}

export interface Order {
  orderId: string;
  companyId: string;
  deliveryDate: string;
  // Optional details for tour display
  name?: string;
  fixedDeliveryTime?: string;
  area?: Area;
  /* Fix: Added address and postCode to interface as they are used in routing and UI */
  address?: string;
  postCode?: string;
  /* Fix: Added street and building for hierarchical density routing logic */
  street?: string;
  building?: number;
  lat?: number;
  lng?: number;
}

export interface Driver {
  id: string;
  name: string;
  level: 1 | 2 | 3 | 4;
  preferredArea?: Area;
  capacity: number;
  isActive: boolean; // Added for fleet management
}

export interface Tour {
  driverId: string;
  driverName: string;
  orders: Order[];
}

export interface WeeklyStats {
  aliJosefStops: number;
  lastUpdated: string;
}

export interface PickupTask {
  companyId: string;
  companyName: string;
  address: string;
  postCode: string;
  area: Area;
  fixedDeliveryTime: string;
  eatingTime?: string;
  status: 'Pending' | 'Done';
}

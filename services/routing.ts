
import { Order, Company, Tour, Driver, Area, BoxStatus, PickupTask } from '../types';
import { MIN_STOPS_EVERYFLEET, START_TIME_MINS, DEADLINE_MINS } from '../constants';
export const KITCHEN_LOCATION = "Friedrich Engels Straße 24, Potsdam";
interface AddressComponents {
  street: string;
  building: number;
}
const parseAddress = (address: string): AddressComponents => {
  const match = address.match(/^([A-Za-zÄÖÜäöüß\s.-]+)\s*(\d+)/);
  if (match) {
    return {
      street: match[1].trim().toLowerCase(),
      building: parseInt(match[2], 10) || 0
    };
  }
  return { street: address.toLowerCase(), building: 0 };
};
// Hierarchical Sector Groups to prevent cross-city jumping
const SECTOR_GROUPS: Record<Area, Area[]> = {
  [Area.PANKOW]: [Area.PRENZLAUER_BERG, Area.WEISSENSEE, Area.REINICKENDORF],
  [Area.MITTE_ZENTRUM]: [Area.TIERGARTEN, Area.MOABIT, Area.WEDDING, Area.PRENZLAUER_BERG],
  [Area.KREUZBERG]: [Area.NEUKOELLN, Area.SCHOENEBERG, Area.TEMPELHOF, Area.FRIEDRICHSHAIN],
  [Area.CHARLOTTENBURG]: [Area.WILMERSDORF, Area.SPANDAU, Area.STEGLITZ, Area.ZEHLENDORF],
  [Area.KOEPENICK]: [Area.TREPTOW, Area.LICHTENBERG, Area.NEUKOELLN],
  [Area.OTHER]: [],
  [Area.PRENZLAUER_BERG]: [Area.PANKOW, Area.MITTE_ZENTRUM],
  [Area.WEISSENSEE]: [Area.PANKOW, Area.LICHTENBERG],
  [Area.REINICKENDORF]: [Area.PANKOW, Area.WEDDING],
  [Area.TREPTOW]: [Area.KOEPENICK, Area.NEUKOELLN],
  [Area.TIERGARTEN]: [Area.MITTE_ZENTRUM, Area.CHARLOTTENBURG],
  [Area.MOABIT]: [Area.MITTE_ZENTRUM, Area.WEDDING],
  [Area.WEDDING]: [Area.MITTE_ZENTRUM, Area.REINICKENDORF],
  [Area.WILMERSDORF]: [Area.CHARLOTTENBURG, Area.SCHOENEBERG],
  [Area.SPANDAU]: [Area.CHARLOTTENBURG],
  [Area.FRIEDRICHSHAIN]: [Area.LICHTENBERG, Area.KREUZBERG],
  [Area.LICHTENBERG]: [Area.FRIEDRICHSHAIN, Area.MARZAHN],
  [Area.MARZAHN]: [Area.LICHTENBERG, Area.HELLERSDORF],
  [Area.HELLERSDORF]: [Area.MARZAHN],
  [Area.NEUKOELLN]: [Area.KREUZBERG, Area.TREPTOW, Area.TEMPELHOF],
  [Area.SCHOENEBERG]: [Area.TEMPELHOF, Area.KREUZBERG, Area.WILMERSDORF],
  [Area.TEMPELHOF]: [Area.SCHOENEBERG, Area.NEUKOELLN, Area.STEGLITZ],
  [Area.STEGLITZ]: [Area.ZEHLENDORF, Area.TEMPELHOF],
  [Area.ZEHLENDORF]: [Area.STEGLITZ, Area.WILMERSDORF],
};
const DRIVER_SECTORS: Record<string, Area[]> = {
  'samir': [Area.KOEPENICK, Area.TREPTOW],
  'ali2': [Area.PANKOW, Area.REINICKENDORF, Area.WEISSENSEE],
  'josef': [Area.MITTE_ZENTRUM, Area.TIERGARTEN, Area.MOABIT, Area.WEDDING],
  'ali1': [Area.FRIEDRICHSHAIN, Area.LICHTENBERG, Area.MARZAHN, Area.HELLERSDORF],
  'ankush': [Area.KREUZBERG, Area.NEUKOELLN, Area.SCHOENEBERG, Area.TEMPELHOF],
  'harsh': [Area.ZEHLENDORF, Area.STEGLITZ, Area.CHARLOTTENBURG, Area.WILMERSDORF, Area.SPANDAU],
};
/**
 * OPTIMIZED ROUTING ALGORITHM
 * Key improvements:
 * 1. Pre-clusters orders by geographic proximity (street > postcode > area)
 * 2. Distributes clusters evenly across ALL drivers
 * 3. Prevents cross-city jumping with strict sector enforcement
 * 4. Balances load before expanding routes
 */
export const calculateTours = (
  rawOrders: any[],
  companies: Company[],
  availableDrivers: Driver[]
): { tours: Tour[], unassigned: Order[] } => {
  const companyMap = new Map(companies.map(c => [c.companyId, c]));
  
  // Parse and enrich orders
  let orderPool = (Array.isArray(rawOrders) ? rawOrders : [rawOrders])
    .map(o => {
      const cid = o.companyId || o.id;
      const detail = companyMap.get(cid) || companies.find(c => c.name.toLowerCase() === (o.name || '').toLowerCase());
      const addr = o.deliveryAddress || detail?.address || '';
      const { street, building } = parseAddress(addr);
      
      return {
        ...o,
        orderId: o.orderId || o.id || Math.random().toString(36).substr(2, 9),
        companyId: detail?.companyId || cid,
        name: o.name || detail?.name || 'Unknown',
        address: addr,
        street,
        building,
        postCode: String(o.deliveryPostalCode || detail?.postCode || '0'),
        area: detail?.area || Area.OTHER,
        fixedDeliveryTime: o.deliverySlotStart || detail?.fixedDeliveryTime || "11:30"
      };
    })
    .filter(o => o.postCode.startsWith('1'));
  // **STEP 1: CREATE GEOGRAPHIC CLUSTERS**
  const clusters = createGeographicClusters(orderPool);
  
  // **STEP 2: ASSIGN CLUSTERS TO DRIVERS BY SECTOR PREFERENCE**
  const tours: Map<string, Tour> = new Map();
  availableDrivers.forEach(d => {
    tours.set(d.id, { driverId: d.id, driverName: d.name, orders: [] });
  });
  const assignedClusters = new Set<number>();
  
  // First pass: Assign clusters to drivers based on their preferred sectors
  for (const driver of availableDrivers) {
    const tour = tours.get(driver.id)!;
    const preferredSectors = DRIVER_SECTORS[driver.id] || [];
    const adjacentSectors = preferredSectors.flatMap(s => SECTOR_GROUPS[s] || []);
    const allowedSectors = Array.from(new Set([...preferredSectors, ...adjacentSectors]));
    
    // Find clusters in driver's preferred sectors
    for (let i = 0; i < clusters.length && tour.orders.length < driver.capacity; i++) {
      if (assignedClusters.has(i)) continue;
      
      const cluster = clusters[i];
      const clusterArea = cluster[0]?.area;
      
      // Check if cluster is in driver's sector
      if (allowedSectors.includes(clusterArea)) {
        const ordersToAdd = cluster.slice(0, driver.capacity - tour.orders.length);
        tour.orders.push(...ordersToAdd as unknown as Order[]);
        
        if (cluster.length === ordersToAdd.length) {
          assignedClusters.add(i);
        } else {
          // Partial cluster assignment - remove assigned orders
          clusters[i] = cluster.slice(ordersToAdd.length);
        }
      }
    }
  }
  // **STEP 3: BALANCE LOAD - Distribute remaining clusters evenly**
  const remainingClusters = clusters.filter((_, idx) => !assignedClusters.has(idx)).flat();
  
  // Sort drivers by current load (ascending) to balance
  const sortedDrivers = [...availableDrivers].sort((a, b) => {
    const aLoad = tours.get(a.id)!.orders.length;
    const bLoad = tours.get(b.id)!.orders.length;
    return aLoad - bLoad;
  });
  for (const order of remainingClusters) {
    // Find driver with lowest load that has capacity
    const driver = sortedDrivers.find(d => {
      const tour = tours.get(d.id)!;
      return tour.orders.length < d.capacity;
    });
    if (driver) {
      const tour = tours.get(driver.id)!;
      
      // Check time constraint
      const estimatedTime = calculateEstimatedTime([...tour.orders, order as unknown as Order]);
      if (estimatedTime <= DEADLINE_MINS) {
        tour.orders.push(order as unknown as Order);
        
        // Re-sort to maintain balance
        sortedDrivers.sort((a, b) => {
          const aLoad = tours.get(a.id)!.orders.length;
          const bLoad = tours.get(b.id)!.orders.length;
          return aLoad - bLoad;
        });
      }
    }
  }
  // **STEP 4: OPTIMIZE EACH TOUR'S SEQUENCE**
  for (const tour of tours.values()) {
    if (tour.orders.length > 1) {
      tour.orders = optimizeTourSequence(tour.orders);
    }
  }
  const assignedOrderIds = new Set(Array.from(tours.values()).flatMap(t => t.orders.map(o => o.orderId)));
  const unassigned = orderPool.filter(o => !assignedOrderIds.has(o.orderId));
  return { 
    tours: Array.from(tours.values()).filter(t => t.orders.length > 0), 
    unassigned: unassigned as unknown as Order[]
  };
};
/**
 * Creates geographic clusters of orders
 * Priority: Same street + adjacent buildings > Same street > Same postcode > Same area
 */
function createGeographicClusters(orders: any[]): any[][] {
  const clusters: any[][] = [];
  const processed = new Set<string>();
  // Sort by area, then postcode, then street for better clustering
  const sorted = [...orders].sort((a, b) => {
    if (a.area !== b.area) return a.area.localeCompare(b.area);
    if (a.postCode !== b.postCode) return a.postCode.localeCompare(b.postCode);
    if (a.street !== b.street) return a.street.localeCompare(b.street);
    return a.building - b.building;
  });
  for (const order of sorted) {
    if (processed.has(order.orderId)) continue;
    const cluster = [order];
    processed.add(order.orderId);
    // Find all orders that should be in this cluster
    for (const candidate of sorted) {
      if (processed.has(candidate.orderId)) continue;
      // Same street and close buildings (within 5 building numbers)
      if (candidate.street === order.street && 
          Math.abs(candidate.building - order.building) <= 5) {
        cluster.push(candidate);
        processed.add(candidate.orderId);
      }
      // Same street (different buildings)
      else if (candidate.street === order.street) {
        cluster.push(candidate);
        processed.add(candidate.orderId);
      }
      // Same postcode
      else if (candidate.postCode === order.postCode && 
               candidate.area === order.area) {
        cluster.push(candidate);
        processed.add(candidate.orderId);
      }
    }
    clusters.push(cluster);
  }
  // Sort clusters by size (descending) to assign larger clusters first
  return clusters.sort((a, b) => b.length - a.length);
}
/**
 * Optimizes the sequence within a single tour using nearest neighbor
 */
function optimizeTourSequence(orders: Order[]): Order[] {
  if (orders.length <= 1) return orders;
  const optimized: Order[] = [];
  const remaining = [...orders];
  // Start with first order
  optimized.push(remaining.shift()!);
  while (remaining.length > 0) {
    const current = optimized[optimized.length - 1];
    
    // Find nearest neighbor
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const score = calculateTravelTime(current, remaining[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    optimized.push(remaining.splice(bestIdx, 1)[0]);
  }
  return optimized;
}
function calculateTravelTime(from: any, to: any): number {
  if (!from || !to) return 5;
  
  // Same building
  if (from.street === to.street && from.building === to.building) return 1;
  
  // Same street, close buildings
  if (from.street === to.street && Math.abs(from.building - to.building) <= 2) return 2;
  
  // Same street
  if (from.street === to.street) return 5;
  
  // Same postcode
  if (from.postCode === to.postCode) return 10;
  
  // Same area
  if (from.area === to.area) return 15;
  
  // Different areas - heavy penalty
  return 30;
}
function calculateEstimatedTime(orders: Order[]): number {
  let time = START_TIME_MINS + 45; // 45 mins from Potsdam to Berlin
  for (let i = 1; i < orders.length; i++) {
    time += calculateTravelTime(orders[i-1], orders[i]);
    time += 3; // 3 mins per stop for delivery
  }
  return time;
}
export const getMissingBoxTasks = (orders: Order[], companies: Company[]): PickupTask[] => {
  const activeTodayIds = new Set(orders.map(o => o.companyId));
  return companies
    .filter(c => c.boxStatus === BoxStatus.PENDING && !activeTodayIds.has(c.companyId))
    .map(c => ({ 
        companyId: c.companyId, 
        companyName: c.name, 
        address: c.address, 
        postCode: c.postCode || '',
        area: c.area,
        fixedDeliveryTime: c.fixedDeliveryTime,
        status: 'Pending' 
    }));
};

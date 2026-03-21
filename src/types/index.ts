export interface Coordinates {
    lat: number;
    lng: number;
  }
  
  export interface TravelTime {
    nextActivityId: string;
    minutes: number;
    distance: number;
    mode: 'WALKING' | 'TRANSIT' | 'DRIVING';
  }
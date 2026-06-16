export const PROVINCE_CITIES = {
  'Gauteng': [
    'Johannesburg', 'Pretoria', 'Sandton', 'Midrand', 'Centurion',
    'Randburg', 'Roodepoort', 'Soweto', 'Boksburg', 'Benoni',
    'Kempton Park', 'Germiston', 'Fourways', 'Edenvale', 'Alberton'
  ],
  'Western Cape': [
    'Cape Town', 'Bellville', 'Claremont', 'Wynberg', 'Durbanville',
    'Somerset West', 'Stellenbosch', 'Paarl', 'George', 'Knysna',
    'Mossel Bay', 'Hermanus', 'Strand', 'Brackenfell', 'Tableview'
  ],
  'KwaZulu-Natal': [
    'Durban', 'Umhlanga', 'Pinetown', 'Pietermaritzburg', 'Ballito',
    'Richards Bay', 'Newcastle', 'Amanzimtoti', 'Hillcrest', 'Westville',
    'Berea', 'Chatsworth', 'Phoenix', 'Tongaat', 'Empangeni'
  ],
  'Eastern Cape': [
    'Gqeberha (Port Elizabeth)', 'East London', 'Mthatha', 'Uitenhage',
    'Makhanda (Grahamstown)', 'Queenstown', 'King Williams Town',
    'Butterworth', 'Jeffreys Bay', 'Port Alfred'
  ],
  'Limpopo': [
    'Polokwane', 'Tzaneen', 'Lephalale', 'Louis Trichardt',
    'Mokopane', 'Bela-Bela', 'Thohoyandou', 'Phalaborwa', 'Giyani', 'Burgersfort'
  ],
  'Mpumalanga': [
    'Mbombela (Nelspruit)', 'eMalahleni (Witbank)', 'Secunda',
    'Middelburg', 'Barberton', 'White River', 'Standerton',
    'Ermelo', 'Lydenburg', 'Hazyview'
  ],
  'North West': [
    'Rustenburg', 'Klerksdorp', 'Mahikeng', 'Potchefstroom',
    'Brits', 'Hartbeespoort', 'Lichtenburg', 'Orkney', 'Vryburg', 'Zeerust'
  ],
  'Free State': [
    'Bloemfontein', 'Welkom', 'Sasolburg', 'Phuthaditjhaba',
    'Kroonstad', 'Bethlehem', 'Harrismith', 'Parys', 'Botshabelo', 'Virginia'
  ],
  'Northern Cape': [
    'Kimberley', 'Upington', 'Springbok', 'De Aar',
    'Kuruman', 'Calvinia', 'Colesberg', 'Douglas', 'Prieska', 'Carnarvon'
  ]
}

export function getAllCities() {
  return Object.values(PROVINCE_CITIES).flat().sort()
}

export function getCitiesForProvince(province) {
  return PROVINCE_CITIES[province] || []
}

// Approximate centre coordinates [lat, lng] for major SA cities, used as a
// fallback for the "Near Me" feature when a listing has no exact coordinates.
export const CITY_COORDS = {
  'Johannesburg': [-26.2041, 28.0473], 'Pretoria': [-25.7479, 28.2293], 'Sandton': [-26.1076, 28.0567],
  'Midrand': [-25.9992, 28.1263], 'Centurion': [-25.8603, 28.1894], 'Randburg': [-26.0936, 28.0064],
  'Roodepoort': [-26.1625, 27.8725], 'Soweto': [-26.2678, 27.8585], 'Boksburg': [-26.2125, 28.2625],
  'Benoni': [-26.1885, 28.3206], 'Kempton Park': [-26.1004, 28.2294], 'Germiston': [-26.2178, 28.1672],
  'Fourways': [-26.0167, 28.0114], 'Edenvale': [-26.1419, 28.1525], 'Alberton': [-26.2672, 28.1222],
  'Cape Town': [-33.9249, 18.4241], 'Bellville': [-33.9022, 18.6298], 'Claremont': [-33.9847, 18.4644],
  'Wynberg': [-34.0011, 18.4694], 'Durbanville': [-33.8303, 18.6492], 'Somerset West': [-34.0833, 18.8500],
  'Stellenbosch': [-33.9321, 18.8602], 'Paarl': [-33.7342, 18.9621], 'George': [-33.9630, 22.4617],
  'Knysna': [-34.0363, 23.0471], 'Mossel Bay': [-34.1831, 22.1461], 'Hermanus': [-34.4187, 19.2345],
  'Strand': [-34.1086, 18.8233], 'Brackenfell': [-33.8719, 18.6936], 'Tableview': [-33.8228, 18.4881],
  'Durban': [-29.8587, 31.0218], 'Umhlanga': [-29.7261, 31.0859], 'Pinetown': [-29.8147, 30.8731],
  'Pietermaritzburg': [-29.6006, 30.3794], 'Ballito': [-29.5389, 31.2144], 'Richards Bay': [-28.7807, 32.0383],
  'Newcastle': [-27.7575, 29.9318], 'Amanzimtoti': [-30.0533, 30.8772], 'Hillcrest': [-29.7783, 30.7619],
  'Westville': [-29.8389, 30.9272], 'Berea': [-29.8419, 31.0011], 'Chatsworth': [-29.9089, 30.8889],
  'Phoenix': [-29.7022, 30.9839], 'Tongaat': [-29.5828, 31.1233], 'Empangeni': [-28.7542, 31.8939],
  'Gqeberha (Port Elizabeth)': [-33.9608, 25.6022], 'East London': [-33.0153, 27.9116], 'Mthatha': [-31.5889, 28.7844],
  'Uitenhage': [-33.7639, 25.3969], 'Makhanda (Grahamstown)': [-33.3107, 26.5219], 'Queenstown': [-31.8976, 26.8753],
  'King Williams Town': [-32.8794, 27.3942], 'Butterworth': [-32.3289, 28.1531], 'Jeffreys Bay': [-34.0507, 24.9117],
  'Port Alfred': [-33.5906, 26.8910],
}

// Province-centre coordinates — guaranteed fallback (every listing has a province).
export const PROVINCE_COORDS = {
  'Gauteng': [-26.2041, 28.0473], 'Western Cape': [-33.9249, 18.4241], 'KwaZulu-Natal': [-29.8587, 31.0218],
  'Eastern Cape': [-33.0153, 27.9116], 'Limpopo': [-23.9045, 29.4689], 'Mpumalanga': [-25.4753, 30.9694],
  'North West': [-25.8560, 25.6403], 'Free State': [-29.1217, 26.2140], 'Northern Cape': [-28.7416, 24.7621],
}

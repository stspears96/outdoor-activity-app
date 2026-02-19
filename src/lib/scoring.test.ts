import { scoreActivities } from './scoring';
import type { WeatherResponse } from './types';

const mockWeather: WeatherResponse = {
  latitude: 37.7749,
  longitude: -122.4194,
  timezone: 'America/Los_Angeles',
  hourly: {
    time: [new Date().toISOString()],
    temperature_2m: [60],
    apparent_temperature: [60],
    precipitation_probability: [0],
    windspeed_10m: [10],
  },
};

describe('scoreActivities', () => {
  it('should return a list of activities including Bike', () => {
    const activities = scoreActivities(mockWeather, 6);
    const bikeActivity = activities.find(a => a.name === 'Bike');
    expect(bikeActivity).toBeDefined();
  });

  it('should not include the old Mountain Bike activity', () => {
    const activities = scoreActivities(mockWeather, 6);
    const mountainBikeActivity = activities.find(a => a.name === 'Mountain Bike');
    expect(mountainBikeActivity).toBeUndefined();
  });

  it('should return a score for each activity', () => {
    const activities = scoreActivities(mockWeather, 6);
    activities.forEach(activity => {
      expect(activity.score).toBeGreaterThanOrEqual(0);
      expect(activity.score).toBeLessThanOrEqual(100);
    });
  });
});

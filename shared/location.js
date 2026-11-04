import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const positionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10_000,
  timeout: 15_000
};

function isNative() {
  return Capacitor.isNativePlatform();
}

export async function getCurrentPosition() {
  if (isNative()) return await Geolocation.getCurrentPosition(positionOptions);
  if (!navigator.geolocation) throw new Error('Este dispositivo não oferece acesso à localização.');

  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, positionOptions);
  });
}

export async function watchCurrentPosition(onPosition, onError) {
  if (isNative()) {
    const watcherId = await Geolocation.watchPosition(positionOptions, (position, error) => {
      if (error) {
        onError(error);
      } else if (position) {
        onPosition(position);
      }
    });
    return () => {
      Geolocation.clearWatch({ id: watcherId }).catch(onError);
    };
  }

  if (!navigator.geolocation) throw new Error('Este dispositivo não oferece acesso à localização.');
  const watcherId = navigator.geolocation.watchPosition(onPosition, onError, positionOptions);
  return () => navigator.geolocation.clearWatch(watcherId);
}

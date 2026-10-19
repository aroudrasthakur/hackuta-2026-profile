/** Keep vercel.json response headers in sync with these values. */
export const permissionsPolicy = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

export const referrerPolicy = "strict-origin-when-cross-origin";

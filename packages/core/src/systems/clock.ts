/** Source of the current monotonic time, in seconds. */
export interface IClock {
  now(): number;
}

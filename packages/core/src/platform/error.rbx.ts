export class Error {
  constructor(message: string) {
    this.message = message;
    this.name = "Error";
  }
  message: string;
  name: string;
}

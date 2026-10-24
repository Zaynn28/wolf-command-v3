export const passwordCopy = {
  invalid: "The current Wolf password is not valid.",
  validation: "Choose a Wolf password of at least 12 characters and enter it twice.",
  unavailable: "The password could not be changed right now.",
  unauthenticated: "Sign in before changing the Wolf password.",
  rejected: "The request was rejected.",
} as const;

export type PasswordFormState = {
  status: "idle" | "invalid" | "validation" | "unavailable" | "unauthenticated";
  message: string;
};

export const initialPasswordState: PasswordFormState = {
  status: "idle",
  message: "",
};

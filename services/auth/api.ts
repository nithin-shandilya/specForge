import { api, APIError } from "encore.dev/api";
import {
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  AuthFlowType,
  ChangePasswordCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Header } from "encore.dev/api";
import { cognitoClient, calculateSecretHash, getClientId } from "./aws/client";
import { CognitoUserPoolId } from "../../health/secrets";
import { getUserByEmail, toPublicUser, type CognitoUserPublic } from "./cognito-db";
import { getAuthData } from "~encore/auth";
import { getUserById } from "./cognito-db";

// ─── Request / Response types ────────────────────────────

interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

interface RegisterResponse {
  user: CognitoUserPublic;
  message: string;
}

interface ConfirmRequest {
  email: string;
  code: string;
}

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  user: CognitoUserPublic;
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  authorization: Header<"Authorization">;
}

// ─── POST /v1/auth/register ──────────────────────────────

export const register = api(
  { expose: true, method: "POST", path: "/v1/auth/register", auth: false },
  async (req: RegisterRequest): Promise<RegisterResponse> => {
    try {
      const command = new SignUpCommand({
        ClientId: getClientId(),
        Username: req.email,
        Password: req.password,
        SecretHash: calculateSecretHash(req.email),
        UserAttributes: [
          { Name: "email", Value: req.email },
          { Name: "name", Value: req.name },
        ],
      });

      const response = await cognitoClient.send(command);

      // Auto-assign to 'user' group
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: CognitoUserPoolId(),
          Username: req.email,
          GroupName: "user",
        })
      );

      return {
        user: {
          id: response.UserSub || "",
          email: req.email,
          name: req.name,
          created_at: new Date(),
          updated_at: new Date(),
        },
        message: "User registered. Please check your email for a verification code.",
      };
    } catch (err: any) {
      if (err.name === "UsernameExistsException") {
        throw APIError.alreadyExists("User with this email already exists");
      }
      if (err.name === "InvalidPasswordException") {
        throw APIError.invalidArgument(
          "Password does not meet complexity requirements"
        );
      }
      throw APIError.internal(err.message);
    }
  }
);

// ─── POST /v1/auth/confirm ───────────────────────────────

export const confirm = api(
  { expose: true, method: "POST", path: "/v1/auth/confirm", auth: false },
  async (req: ConfirmRequest): Promise<{ success: boolean; message: string }> => {
    try {
      const command = new ConfirmSignUpCommand({
        ClientId: getClientId(),
        Username: req.email,
        ConfirmationCode: req.code,
        SecretHash: calculateSecretHash(req.email),
      });

      await cognitoClient.send(command);

      return {
        success: true,
        message: "Email confirmed. You can now log in.",
      };
    } catch (err: any) {
      if (err.name === "CodeMismatchException") {
        throw APIError.invalidArgument("Invalid verification code");
      }
      if (err.name === "ExpiredCodeException") {
        throw APIError.invalidArgument("Verification code has expired");
      }
      throw APIError.internal(err.message);
    }
  }
);

// ─── POST /v1/auth/login ─────────────────────────────────

export const login = api(
  { expose: true, method: "POST", path: "/v1/auth/login", auth: false },
  async (req: LoginRequest): Promise<LoginResponse> => {
    try {
      const command = new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: getClientId(),
        AuthParameters: {
          USERNAME: req.email,
          PASSWORD: req.password,
          SECRET_HASH: calculateSecretHash(req.email) || "",
        },
      });

      const response = await cognitoClient.send(command);

      if (
        !response.AuthenticationResult ||
        !response.AuthenticationResult.IdToken
      ) {
        throw APIError.unauthenticated("Authentication failed");
      }

      const idToken = response.AuthenticationResult.IdToken;
      const accessToken = response.AuthenticationResult.AccessToken || "";
      const refreshToken = response.AuthenticationResult.RefreshToken || "";

      // Look up user in Cognito
      const user = await getUserByEmail(req.email);
      if (!user) throw APIError.notFound("User record not found");

      return {
        user: toPublicUser(user),
        idToken,
        accessToken,
        refreshToken,
      };
    } catch (err: any) {
      if (
        err.name === "NotAuthorizedException" ||
        err.name === "UserNotFoundException"
      ) {
        throw APIError.unauthenticated("Invalid email or password");
      }
      if (err.name === "UserNotConfirmedException") {
        throw APIError.failedPrecondition(
          "Email not confirmed. Please check your email for the verification code."
        );
      }
      throw APIError.internal(err.message);
    }
  }
);

// ─── GET /v1/auth/me (requires auth) ────────────────────

export const me = api(
  { expose: true, method: "GET", path: "/v1/auth/me", auth: true },
  async (): Promise<{ user: CognitoUserPublic }> => {
    const authData = getAuthData();
    if (!authData) throw APIError.unauthenticated("Not authenticated");

    const user = await getUserById(authData.userID);
    if (!user) throw APIError.notFound("User not found");

    return { user: toPublicUser(user) };
  }
);

// ─── POST /v1/auth/change-password (requires auth) ──────

export const changePassword = api(
  {
    expose: true,
    method: "POST",
    path: "/v1/auth/change-password",
    auth: true,
  },
  async (
    req: ChangePasswordRequest
  ): Promise<{ success: boolean }> => {
    const accessToken = req.authorization.replace("Bearer ", "");

    try {
      const command = new ChangePasswordCommand({
        AccessToken: accessToken,
        PreviousPassword: req.current_password,
        ProposedPassword: req.new_password,
      });

      await cognitoClient.send(command);
      return { success: true };
    } catch (err: any) {
      if (err.name === "NotAuthorizedException") {
        throw APIError.invalidArgument("Current password is incorrect");
      }
      if (err.name === "InvalidPasswordException") {
        throw APIError.invalidArgument(
          "New password does not meet complexity requirements"
        );
      }
      throw APIError.internal(err.message);
    }
  }
);
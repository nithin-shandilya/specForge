import { Gateway, APIError } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CognitoUserPoolId, CognitoClientId } from "../../health/secrets";
import { getUserById } from "./cognito-db";
import { Header } from "encore.dev/api";

// Initialize the JWT Verifier (caches public keys automatically)
const verifier = CognitoJwtVerifier.create({
  userPoolId: CognitoUserPoolId(),
  tokenUse: "id",
  clientId: CognitoClientId(),
});

interface AuthParams {
  authorization: Header<"Authorization">;
}

export interface AuthData {
  userID: string;
  email: string;
}

// Auth handler — verifies JWT from Authorization header
export const auth = authHandler<AuthParams, AuthData>(async (params) => {
  const raw = params.authorization;
  if (!raw) {
    throw APIError.unauthenticated("Missing Authorization header");
  }

  const token = raw.replace("Bearer ", "");

  try {
    // 1. Verify Cognito JWT signature + expiry
    const payload = await verifier.verify(token);

    // 2. Extract claims
    const userID = payload.sub;
    const email = (payload.email as string) || "";

    // 3. Confirm user still exists in Cognito
    const user = await getUserById(userID);
    if (!user) {
      throw APIError.unauthenticated("User not found or account disabled");
    }

    return { userID, email };
  } catch (error: any) {
    if (error instanceof APIError) throw error;

    if (
      error.name === "JwtExpiredError" ||
      error.name === "TokenExpiredError"
    ) {
      throw APIError.unauthenticated("Token has expired");
    }
    if (error.name === "JWSSignatureVerificationFailed") {
      throw APIError.unauthenticated("Invalid token signature");
    }

    throw APIError.unauthenticated(`Authentication failed: ${error.message}`);
  }
});

// Gateway — tells Encore to use this auth handler for all routes
export const gateway = new Gateway({
  authHandler: auth,
});
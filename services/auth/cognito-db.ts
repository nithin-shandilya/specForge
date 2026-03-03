import {
    AdminGetUserCommand,
    ListUsersCommand,
    AdminUpdateUserAttributesCommand,
    AdminSetUserPasswordCommand,
    AttributeType,
  } from "@aws-sdk/client-cognito-identity-provider";
  import { CognitoUserPoolId } from "../../health/secrets";
  import { cognitoClient } from "./aws/client";
  
  export interface CognitoUser {
    id: string;
    email: string;
    name: string;
    created_at: Date;
    updated_at: Date;
  }
  
  export interface CognitoUserPublic {
    id: string;
    email: string;
    name: string;
    created_at: Date;
    updated_at: Date;
  }
  
  /**
   * Helper: Maps Cognito attribute list to a structured User object
   */
  function mapCognitoToUser(
    sub: string,
    attributes: AttributeType[] | undefined,
    createdAt?: Date,
    updatedAt?: Date
  ): CognitoUser {
    const attrMap: Record<string, string> = {};
    attributes?.forEach((attr) => {
      if (attr.Name && attr.Value) attrMap[attr.Name] = attr.Value;
    });
  
    return {
      id: sub,
      email: attrMap["email"] || "",
      name: attrMap["name"] || "",
      created_at: createdAt || new Date(),
      updated_at: updatedAt || new Date(),
    };
  }
  
  /**
   * Get user by email (Cognito ListUsers with filter)
   */
  export async function getUserByEmail(
    email: string
  ): Promise<CognitoUser | null> {
    const command = new ListUsersCommand({
      UserPoolId: CognitoUserPoolId(),
      Filter: `email = "${email}"`,
      Limit: 1,
    });
  
    const response = await cognitoClient.send(command);
    const user = response.Users?.[0];
  
    if (!user || !user.Username) return null;
  
    return mapCognitoToUser(
      user.Attributes?.find((a) => a.Name === "sub")?.Value || user.Username,
      user.Attributes,
      user.UserCreateDate,
      user.UserLastModifiedDate
    );
  }
  
  /**
   * Get user by Cognito sub (Admin API)
   */
  export async function getUserById(id: string): Promise<CognitoUser | null> {
    try {
      const command = new AdminGetUserCommand({
        UserPoolId: CognitoUserPoolId(),
        Username: id,
      });
  
      const response = await cognitoClient.send(command);
      return mapCognitoToUser(
        id,
        response.UserAttributes,
        response.UserCreateDate,
        response.UserLastModifiedDate
      );
    } catch (err: any) {
      if (err.name === "UserNotFoundException") return null;
      throw err;
    }
  }
  
  /**
   * Update user attributes in Cognito
   */
  export async function updateUser(
    id: string,
    updates: { name?: string; email?: string; password?: string }
  ): Promise<CognitoUser | null> {
    const attributes: AttributeType[] = [];
  
    if (updates.name) attributes.push({ Name: "name", Value: updates.name });
    if (updates.email) attributes.push({ Name: "email", Value: updates.email });
  
    if (attributes.length > 0) {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: CognitoUserPoolId(),
          Username: id,
          UserAttributes: attributes,
        })
      );
    }
  
    if (updates.password) {
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: CognitoUserPoolId(),
          Username: id,
          Password: updates.password,
          Permanent: true,
        })
      );
    }
  
    return getUserById(id);
  }
  
  export function toPublicUser(user: CognitoUser): CognitoUserPublic {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
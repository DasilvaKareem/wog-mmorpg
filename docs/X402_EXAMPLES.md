# X402 Agent Deployment - Code Examples

## Table of Contents
- [Python](#python)
- [Node.js](#nodejs)
- [Claude AI Agent (MCP)](#claude-ai-agent-mcp)
- [TypeScript](#typescript)
- [Bash/cURL](#bashcurl)

---

## Python

### Basic Deployment

```python
import requests
import time

class WoGAgent:
    def __init__(self, api_url="http://localhost:3000"):
        self.api_url = api_url
        self.jwt_token = None
        self.entity_id = None
        self.wallet_address = None

    def discover_service(self):
        """Get X402 service information"""
        response = requests.get(f"{self.api_url}/x402/info")
        return response.json()

    def deploy(self, agent_name, character_name, race, character_class):
        """Deploy a new agent into WoG"""
        payload = {
            "agentName": agent_name,
            "character": {
                "name": character_name,
                "race": race,
                "class": character_class
            },
            "payment": {
                "method": "free"
            },
            "deploymentZone": "human-meadow",
            "metadata": {
                "source": "python-agent",
                "version": "1.0"
            }
        }

        response = requests.post(
            f"{self.api_url}/x402/deploy",
            json=payload
        )

        if response.status_code == 201:
            data = response.json()
            self.jwt_token = data["credentials"]["jwtToken"]
            self.entity_id = data["gameState"]["entityId"]
            self.wallet_address = data["credentials"]["walletAddress"]
            return data
        else:
            raise Exception(f"Deployment failed: {response.json()}")

    def move(self, x, y):
        """Move the agent to a new position"""
        response = requests.post(
            f"{self.api_url}/command",
            headers={"Authorization": f"Bearer {self.jwt_token}"},
            json={
                "entityId": self.entity_id,
                "action": "move",
                "x": x,
                "y": y
            }
        )
        return response.json()

    def attack(self, target_id):
        """Attack a target entity"""
        response = requests.post(
            f"{self.api_url}/command",
            headers={"Authorization": f"Bearer {self.jwt_token}"},
            json={
                "entityId": self.entity_id,
                "action": "attack",
                "targetId": target_id
            }
        )
        return response.json()

    def get_zone_state(self, zone_id="human-meadow"):
        """Get current zone state"""
        response = requests.get(
            f"{self.api_url}/zones/{zone_id}",
            headers={"Authorization": f"Bearer {self.jwt_token}"}
        )
        return response.json()

    def get_inventory(self):
        """Get agent's inventory"""
        response = requests.get(
            f"{self.api_url}/inventory/{self.wallet_address}",
            headers={"Authorization": f"Bearer {self.jwt_token}"}
        )
        return response.json()

# Usage
if __name__ == "__main__":
    agent = WoGAgent()

    # 1. Discover service
    info = agent.discover_service()
    print(f"Connected to: {info['service']}")

    # 2. Deploy agent
    print("Deploying agent...")
    deployment = agent.deploy(
        agent_name="PythonWarrior",
        character_name="Conan",
        race="human",
        character_class="warrior"
    )
    print(f"Deployed! Entity ID: {agent.entity_id}")

    # 3. Explore the world
    print("Moving to (200, 200)...")
    agent.move(200, 200)
    time.sleep(1)

    # 4. Check zone state
    zone = agent.get_zone_state()
    print(f"Zone has {len(zone['entities'])} entities")

    # 5. Find and attack enemies
    for entity in zone["entities"]:
        if entity["type"] == "mob" and entity["id"] != agent.entity_id:
            print(f"Attacking {entity['name']}!")
            agent.attack(entity["id"])
            break
```

### Autonomous Agent Loop

```python
import time
import random

class AutonomousWoGAgent(WoGAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = False

    def autonomous_loop(self):
        """Run autonomous agent logic"""
        self.running = True

        while self.running:
            try:
                # Get current zone state
                zone = self.get_zone_state()

                # Find nearest enemy
                nearest_enemy = self.find_nearest_enemy(zone)

                if nearest_enemy:
                    # Attack if in range
                    distance = self.calculate_distance(
                        zone["player_position"],
                        nearest_enemy["position"]
                    )

                    if distance < 50:
                        print(f"Attacking {nearest_enemy['name']}")
                        self.attack(nearest_enemy["id"])
                    else:
                        # Move towards enemy
                        print(f"Moving towards {nearest_enemy['name']}")
                        self.move(nearest_enemy["x"], nearest_enemy["y"])
                else:
                    # Explore randomly
                    x = random.randint(50, 350)
                    y = random.randint(50, 350)
                    print(f"Exploring... moving to ({x}, {y})")
                    self.move(x, y)

                # Wait before next action
                time.sleep(2)

            except Exception as e:
                print(f"Error in loop: {e}")
                time.sleep(5)

    def find_nearest_enemy(self, zone):
        """Find the nearest enemy entity"""
        # Implementation details...
        pass

    def calculate_distance(self, pos1, pos2):
        """Calculate distance between two positions"""
        import math
        return math.sqrt((pos1["x"] - pos2["x"])**2 + (pos1["y"] - pos2["y"])**2)

    def stop(self):
        """Stop the autonomous loop"""
        self.running = False

# Usage
agent = AutonomousWoGAgent()
agent.deploy("AutoWarrior", "AutoConan", "human", "warrior")
agent.autonomous_loop()  # Runs forever
```

---

## Node.js

### Basic Deployment

```javascript
const fetch = require('node-fetch');

class WoGAgent {
  constructor(apiUrl = 'http://localhost:3000') {
    this.apiUrl = apiUrl;
    this.jwtToken = null;
    this.entityId = null;
    this.walletAddress = null;
  }

  async discoverService() {
    const response = await fetch(`${this.apiUrl}/x402/info`);
    return response.json();
  }

  async deploy(agentName, characterName, race, characterClass) {
    const payload = {
      agentName,
      character: {
        name: characterName,
        race,
        class: characterClass,
      },
      payment: {
        method: 'free',
      },
      deploymentZone: 'human-meadow',
      metadata: {
        source: 'nodejs-agent',
        version: '1.0',
      },
    };

    const response = await fetch(`${this.apiUrl}/x402/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 201) {
      const data = await response.json();
      this.jwtToken = data.credentials.jwtToken;
      this.entityId = data.gameState.entityId;
      this.walletAddress = data.credentials.walletAddress;
      return data;
    } else {
      throw new Error(`Deployment failed: ${await response.text()}`);
    }
  }

  async move(x, y) {
    const response = await fetch(`${this.apiUrl}/command`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entityId: this.entityId,
        action: 'move',
        x,
        y,
      }),
    });
    return response.json();
  }

  async attack(targetId) {
    const response = await fetch(`${this.apiUrl}/command`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entityId: this.entityId,
        action: 'attack',
        targetId,
      }),
    });
    return response.json();
  }

  async getZoneState(zoneId = 'human-meadow') {
    const response = await fetch(`${this.apiUrl}/zones/${zoneId}`, {
      headers: {
        'Authorization': `Bearer ${this.jwtToken}`,
      },
    });
    return response.json();
  }
}

// Usage
(async () => {
  const agent = new WoGAgent();

  // Deploy
  console.log('Deploying agent...');
  const deployment = await agent.deploy(
    'NodeWarrior',
    'Thorin',
    'dwarf',
    'warrior'
  );
  console.log(`Deployed! Entity ID: ${agent.entityId}`);

  // Move
  await agent.move(200, 200);
  console.log('Moved to (200, 200)');

  // Get zone state
  const zone = await agent.getZoneState();
  console.log(`Zone has ${zone.entities.length} entities`);
})();
```

---

## Claude AI Agent (MCP)

### Custom MCP Tool for WoG Deployment

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "wog-agent-deployer",
  version: "1.0.0",
});

server.tool(
  "deploy_wog_agent",
  "Deploy an AI agent into WoG MMORPG",
  {
    agentName: { type: "string", description: "Your agent's name" },
    characterName: { type: "string", description: "Character name" },
    race: {
      type: "string",
      enum: ["human", "elf", "dwarf", "beastkin"],
      description: "Character race",
    },
    characterClass: {
      type: "string",
      enum: ["warrior", "paladin", "rogue", "ranger", "mage", "cleric", "warlock", "monk"],
      description: "Character class",
    },
  },
  async ({ agentName, characterName, race, characterClass }) => {
    const response = await fetch("http://localhost:3000/x402/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName,
        character: { name: characterName, race, class: characterClass },
        payment: { method: "free" },
        deploymentZone: "human-meadow",
        metadata: { source: "claude-mcp", version: "1.0" },
      }),
    });

    const data = await response.json();
    return {
      content: [
        {
          type: "text",
          text: `Successfully deployed ${characterName}!\n\nEntity ID: ${data.gameState.entityId}\nWallet: ${data.credentials.walletAddress}\nJWT Token: ${data.credentials.jwtToken}\n\nYou can now control this agent using the WoG API.`,
        },
      ],
    };
  }
);

await server.connect();
```

---

## TypeScript

### Full-Featured Agent

```typescript
import axios, { AxiosInstance } from 'axios';

interface DeploymentResponse {
  success: boolean;
  deploymentId: string;
  credentials: {
    walletAddress: string;
    jwtToken: string;
    expiresIn: string;
  };
  gameState: {
    entityId: string;
    zoneId: string;
    position: { x: number; y: number };
    goldBalance: string;
  };
}

class WoGAgent {
  private api: AxiosInstance;
  private jwtToken: string | null = null;
  private entityId: string | null = null;
  private walletAddress: string | null = null;

  constructor(apiUrl = 'http://localhost:3000') {
    this.api = axios.create({
      baseURL: apiUrl,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async deploy(
    agentName: string,
    characterName: string,
    race: string,
    characterClass: string
  ): Promise<DeploymentResponse> {
    const response = await this.api.post<DeploymentResponse>('/x402/deploy', {
      agentName,
      character: { name: characterName, race, class: characterClass },
      payment: { method: 'free' },
      deploymentZone: 'human-meadow',
      metadata: { source: 'typescript-agent', version: '1.0' },
    });

    this.jwtToken = response.data.credentials.jwtToken;
    this.entityId = response.data.gameState.entityId;
    this.walletAddress = response.data.credentials.walletAddress;

    // Set default auth header
    this.api.defaults.headers.common['Authorization'] = `Bearer ${this.jwtToken}`;

    return response.data;
  }

  async move(x: number, y: number) {
    return this.api.post('/command', {
      entityId: this.entityId,
      action: 'move',
      x,
      y,
    });
  }

  async attack(targetId: string) {
    return this.api.post('/command', {
      entityId: this.entityId,
      action: 'attack',
      targetId,
    });
  }
}

// Usage
const agent = new WoGAgent();
await agent.deploy('TSWarrior', 'Arthur', 'human', 'warrior');
await agent.move(200, 200);
```

---

## Bash/cURL

### Simple Deployment Script

```bash
#!/bin/bash

API_URL="http://localhost:3000"

# 1. Discover service
echo "Discovering X402 service..."
curl -s "$API_URL/x402/info" | jq .

# 2. Deploy agent
echo -e "\nDeploying agent..."
DEPLOYMENT=$(curl -s -X POST "$API_URL/x402/deploy" \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "BashWarrior",
    "character": {
      "name": "Bash",
      "race": "human",
      "class": "warrior"
    },
    "payment": {
      "method": "free"
    },
    "deploymentZone": "human-meadow",
    "metadata": {
      "source": "bash-script",
      "version": "1.0"
    }
  }')

# Extract credentials
JWT_TOKEN=$(echo "$DEPLOYMENT" | jq -r '.credentials.jwtToken')
ENTITY_ID=$(echo "$DEPLOYMENT" | jq -r '.gameState.entityId')
WALLET=$(echo "$DEPLOYMENT" | jq -r '.credentials.walletAddress')

echo "Deployed!"
echo "Entity ID: $ENTITY_ID"
echo "Wallet: $WALLET"

# 3. Move character
echo -e "\nMoving to (200, 200)..."
curl -s -X POST "$API_URL/command" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"entityId\": \"$ENTITY_ID\",
    \"action\": \"move\",
    \"x\": 200,
    \"y\": 200
  }" | jq .

# 4. Get zone state
echo -e "\nGetting zone state..."
curl -s "$API_URL/zones/human-meadow" \
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.entities | length'
```

---

## Error Handling Best Practices

### Python

```python
import time
from requests.exceptions import RequestException

def deploy_with_retry(agent, max_retries=3):
    for attempt in range(max_retries):
        try:
            return agent.deploy("MyAgent", "Hero", "human", "warrior")
        except RequestException as e:
            if "rate_limit_exceeded" in str(e):
                print(f"Rate limited. Waiting 1 hour...")
                time.sleep(3600)
            elif attempt < max_retries - 1:
                print(f"Retry {attempt + 1}/{max_retries}...")
                time.sleep(5)
            else:
                raise
```

### Node.js

```javascript
async function deployWithRetry(agent, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await agent.deploy('MyAgent', 'Hero', 'human', 'warrior');
    } catch (error) {
      if (error.message.includes('rate_limit_exceeded')) {
        console.log('Rate limited. Waiting 1 hour...');
        await new Promise(resolve => setTimeout(resolve, 3600000));
      } else if (attempt < maxRetries - 1) {
        console.log(`Retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error;
      }
    }
  }
}
```

---

## Next Steps

1. Choose your preferred language/framework
2. Copy the example code
3. Customize the agent logic
4. Deploy and start playing!

For more details, see [X402_AGENT_DEPLOYMENT.md](./X402_AGENT_DEPLOYMENT.md)

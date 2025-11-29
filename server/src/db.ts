import mysql from 'mysql2/promise';

export interface DbConfig {
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

let pool: mysql.Pool | null = null;

export function getDbConfigFromEnv(): DbConfig {
  const {
    DATABASE_URL,
    MYSQL_URL,
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE
  } = process.env;
  return {
    uri: DATABASE_URL || MYSQL_URL,
    host: MYSQL_HOST,
    port: MYSQL_PORT ? Number.parseInt(MYSQL_PORT, 10) : undefined,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE
  };
}

export function getPool(config: DbConfig = getDbConfigFromEnv()): mysql.Pool {
  if (pool) {
    return pool;
  }
  if (config.uri) {
    pool = mysql.createPool({ uri: config.uri, connectionLimit: 10 });
    return pool;
  }
  if (!config.host || !config.user || !config.database) {
    throw new Error(
      'MySQL config missing; set DATABASE_URL or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE'
    );
  }
  pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 10
  });
  return pool;
}

export async function ensureTables(db: mysql.Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS lists (
      id VARCHAR(64) PRIMARY KEY,
      owner_id VARCHAR(128) NOT NULL,
      name VARCHAR(255) NOT NULL,
      visibility ENUM('public','private') NOT NULL DEFAULT 'private',
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS list_collaborators (
      list_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(128) NOT NULL,
      PRIMARY KEY (list_id, user_id),
      CONSTRAINT fk_list_collaborators_list
        FOREIGN KEY (list_id) REFERENCES lists(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS list_docs (
      list_id VARCHAR(64) PRIMARY KEY,
      doc LONGBLOB NOT NULL,
      updated_at DATETIME NOT NULL,
      CONSTRAINT fk_list_docs_list
        FOREIGN KEY (list_id) REFERENCES lists(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bulletin_docs (
      id TINYINT PRIMARY KEY,
      doc LONGBLOB NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

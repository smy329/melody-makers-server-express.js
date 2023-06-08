const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**after running node on terminal, type "require('crypto').randomBytes(64).toString('hex')". In this way, you can generate 64 byte ACCESS_TOKEN_SECRET key  */
const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'Unauthorized Access' });
  }
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'Invalid Token' });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pcfhua9.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db('melodyMakersCampDB').collection('users');
    const classesCollection = client.db('melodyMakersCampDB').collection('classes');

    //jwt
    app.post('/jwt', (req, res) => {
      const userEmail = req.body;
      const token = jwt.sign(userEmail, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      console.log(token);
      res.send({ token });
    });

    //middleware verifyAdmin: this code must be excuted after database connection. For finding admin we need  database.
    // must be write this middleware after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'Forbidden Access' });
      }

      //next() means you can proceed
      next();
    };

    app.get('/admin/users/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      console.log(email);

      if (req.decoded.email !== email) {
        return res.status(403).status({ error: true, message: 'Access Forbidden' });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      //const result = { admin: user?.role === 'admin' };
      //const result = user?.role === 'admin';
      const result = { admin: user?.role === 'admin' };
      console.log(result);
      res.send(result);
    });

    //users related api
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      //console.log(user);
      const query = { email: user.email };
      //console.log(query);
      const existingUser = await usersCollection.findOne(query);
      //console.log(existingUser);
      if (existingUser) {
        return res.send({ message: 'User already exists ' });
      }
      const result = await usersCollection.insertOne(user);
      //console.log(result);
      res.send(result);
    });

    app.get('/popular-classes', async (req, res) => {
      const result = await classesCollection.find().sort({ enrolledStudents: -1 }).limit(6).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  // Set a cookie named 'myCookie' with the value 'example'
  res.cookie('melody-makers-camp-cookie', 'I am here');
  res.send('Hello from, Melody Maker Camp. Check your cookie to get your gift');
});

app.listen(port, () => {
  console.log(`Running at port: ${port}`);
});

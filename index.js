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
    //await client.connect();

    const usersCollection = client.db('melodyMakersCampDB').collection('users');
    const classesCollection = client.db('melodyMakersCampDB').collection('classes');
    const instructorsCollection = client.db('melodyMakersCampDB').collection('instructors');

    //jwt
    app.post('/jwt', (req, res) => {
      const userEmail = req.body;
      const token = jwt.sign(userEmail, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
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

    app.get('/roles/users/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.status(403).status({ error: true, message: 'Access Forbidden' });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      //const result = { admin: user?.role === 'admin' };
      //const result = user?.role === 'admin';
      const result = { admin: user?.role === 'admin', instructor: user?.role === 'instructor' };
      res.send(result);
    });

    /**
     *
     * =============================== PUBLIC API ===========================
     *
     */

    app.get('/classes', async (req, res) => {
      const query = { status: 'approved' };
      const result = await classesCollection.find(query).toArray();
      res.send(result);
    });

    app.get('/popular-classes', async (req, res) => {
      const result = await classesCollection.find().sort({ enrolledStudents: -1 }).limit(6).toArray();
      res.send(result);
    });

    app.get('/instructors', async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'classesCollection', // collection to join
            localField: 'email', //field from the input documents
            foreignField: 'instructorEmail', //field from the documents of the "from" collection
            as: 'classData', //output array field
          },
        },
        {
          $addFields: {
            totalStudents: { $sum: '$classData.enrolledStudents' }, //add this field into output array
          },
        },
        {
          $sort: { totalStudents: -1 },
        },
        {
          $limit: 6,
        },
      ];
      const result = await instructorsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    app.get('/popular-instructors', async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'classesCollection', // collection to join
            localField: 'email', //field from the input documents
            foreignField: 'instructorEmail', //field from the documents of the "from" collection
            as: 'classData', //output array field
          },
        },
        {
          $addFields: {
            totalStudents: { $sum: '$classData.enrolledStudents' }, //add this field into output array
          },
        },
        {
          $sort: { totalStudents: -1 },
        },
        {
          $limit: 6,
        },
      ];

      const result = await instructorsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    /**
     *
     * ======================== USER API =========================================
     *
     */

    //registering users
    app.post('/users', async (req, res) => {
      const userData = req.body;
      console.log(userData);
      const query = { email: userData.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'User already exists ' });
      }
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    app.get('/users/selected-classes/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = user.selectedClasses;
      res.send(result);
    });

    //push selected classes into DB
    app.patch('/users/select-classes', verifyJWT, async (req, res) => {
      const selectedClass = req.body;
      const query = { email: selectedClass.email };
      const updateUser = {
        $push: { selectedClasses: selectedClass.classId }, // we use this when we need to push data into existing array
      };
      const result = await usersCollection.findOneAndUpdate(query, updateUser);
      res.send(result);
    });

    //delete selected classes from user collection
    app.patch('/users/selected-class', verifyJWT, async (req, res) => {
      const data = req.body;
      const query = { email: data.email };
      const updateUser = {
        $pull: { selectedClasses: data.classId }, // we use this when we need to pull data into existing array
      };
      const result = await usersCollection.findOneAndUpdate(query, updateUser);
      res.send(result);
    });

    //push enrolled classes into DB
    app.patch('/users/enrolled-classes', verifyJWT, async (req, res) => {
      const enrolledClass = req.body;
      const query = { email: enrolledClass.email };
      const classQuery = { _id: new ObjectId(enrolledClass.classId) };
      console.log(classQuery);
      console.log(enrolledClass.classId);
      const updateUser = {
        $push: { enrolledClasses: enrolledClass.classId }, // we use this when we need to push data into existing array
        $pull: { selectedClasses: enrolledClass.classId }, // we use this when we need to pull data into existing array
      };

      const updateSeat = { $inc: { enrolledStudents: 1 } };
      const updateClasses = await classesCollection.findOneAndUpdate(classQuery, { $inc: { enrolledStudents: 1 } });
      const updateUsers = await usersCollection.findOneAndUpdate(query, updateUser);
      res.send({ updateClasses, updateUsers });
    });

    //get selected classes for users
    app.get('/users/dashboard/selected-classes/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const selectedClassIds = user?.selectedClasses || [];

      const classQuery = {
        _id: {
          $in: selectedClassIds.map((id) => new ObjectId(id)),
        },
      };
      const result = await classesCollection.find(classQuery).toArray();
      res.send(result);
    });

    //get enrolled classes for users
    app.get('/users/dashboard/enrolled-classes/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const enrolledClassIds = user?.enrolledClasses || [];

      const classQuery = {
        _id: {
          $in: enrolledClassIds.map((id) => new ObjectId(id)),
        },
      };
      const result = await classesCollection.find(classQuery).toArray();
      res.send(result);
    });

    /**
     *
     * ===================== Instructor Panel Api=========================================
     *
     */

    //get myClasses for instructors
    app.get('/instructors/dashboard/my-classes/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const classIds = user?.classes || [];

      const classQuery = {
        _id: {
          $in: classIds.map((id) => new ObjectId(id)),
        },
      };
      const result = await classesCollection.find(classQuery).toArray();
      res.send(result);
    });

    // add new classes from instructor panel
    app.post('/instructors/add-class', async (req, res) => {
      const newClass = req.body;
      const insertClass = await classesCollection.insertOne(newClass);

      //retrive the generated _id
      const newClassId = insertClass.insertedId.toString();
      const query = { email: newClass.instructorEmail };
      console.log(query);
      const updateInstructor = {
        $push: { classes: newClassId }, // we use this when we need to push data into existing array
      };
      const result = await usersCollection.findOneAndUpdate(query, updateInstructor);
      res.send(result);
    });

    /**
     *
     * ========================= ADMIN API ======================================
     *
     * * */

    // getting all users
    app.get('/manage-users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    //updating user role
    app.patch('/manage-users/role', verifyJWT, verifyAdmin, async (req, res) => {
      const data = req.body;
      const query = { email: data.email };
      const updateUser = {
        $set: {
          role: data.role,
        },
      };
      const result = await usersCollection.findOneAndUpdate(query, updateUser);
      res.send(result);
    });

    //getting all classes Available
    app.get('/manage-classes', async (req, res) => {
      const result = await classesCollection.find().toArray();
      res.send(result);
    });

    //updating class status
    app.patch('/manage-classes/status', verifyJWT, verifyAdmin, async (req, res) => {
      const data = req.body;
      const query = { _id: new ObjectId(data.classId) };
      const updateClass = {
        $set: {
          status: data.status,
        },
      };
      const result = await classesCollection.findOneAndUpdate(query, updateClass);
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

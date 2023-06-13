import './style.css'

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, addDoc, setDoc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';

// Firebase Setup
const firebaseConfig = {
  apiKey: "AIzaSyBLk1331vgwDb75yOGiZ9aRdlasqhZSdKg",
  authDomain: "steam-webrtc.firebaseapp.com",
  projectId: "steam-webrtc",
  storageBucket: "steam-webrtc.appspot.com",
  messagingSenderId: "1036894672315",
  appId: "1:1036894672315:web:8045a9472812233175a09e"
};

const app = initializeApp(firebaseConfig);

const firestore = getFirestore(app);

// STUN Server Setup
const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create An Offer
callButton.onclick = async () => {
  // Reference Firestore collections For Signaling
  const callDoc = doc(collection(firestore, "calls"), "room");
  const offerCandidates = collection(firestore, "calls", callDoc.id, "offerCandidates");
  const answerCandidates = collection(firestore, "calls", callDoc.id, 'answerCandidates');

  // Get Candidates For Caller, Save To db
  pc.onicecandidate = async (event) => {
    event.candidate && await addDoc(offerCandidates, event.candidate.toJSON());
  };

  // Create Offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await setDoc(callDoc, { offer });

  // Listen for remote answer
  onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  onSnapshot(answerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  callButton.disabled = true;
  answerButton.disabled = true;
};

// 3. Answer The Call
answerButton.onclick = async () => {
  const callId = "room";
  const callDoc = doc(firestore, "calls", callId);
  const answerCandidates = collection(firestore, "calls", callDoc.id, 'answerCandidates');
  const offerCandidates = collection(firestore, "calls", callDoc.id, "offerCandidates");

  pc.onicecandidate = async (event) => {
    event.candidate && await addDoc(answerCandidates, event.candidate.toJSON());
  };
  
  const callData = (await getDoc(callDoc)).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await updateDoc(callDoc, {answer});

  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  callButton.disabled = true;
  answerButton.disabled = true;
};
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = 'https://75c2-2407-d000-f-cad2-282e-7f18-8a82-becc.ngrok-free.app'; // Update with your server URL
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NTI5Njg1MDRmMjEzZWJmZDVmYjAyYyIsImVtYWlsIjoiYmV0YUBnbWFpbC5jb20iLCJ1c2VybmFtZSI6ImJldGEiLCJpYXQiOjE3MzQ2ODgzOTUsImV4cCI6MTczNDc3NDc5NX0.jW1cAZQKbY9qNXQcP6g_VyHRahaT_FqaXOP5AA9Sk-g'; // Replace with your actual token

let peerConnection = null;
let localStream = null;
let remoteStream = new MediaStream();

const CallComponent = () => {
  const [socket, setSocket] = useState(null);
  const [receiverId, setReceiverId] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const socketInstance = io(`${SERVER_URL}/im`, {
      query: { token }, // You might want to move this to a header on the server side
    });

    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to server');
    });

    socketInstance.on('incomingCall', (callData) => {
      console.log(`Incoming call from ${callData.senderName} (${callData.callType})`);
      setIncomingCall(callData);
      setCallStatus('Incoming');
    });

    socketInstance.on('callAnswered', (data) => {
      console.log(`Call ${data.callId} answered`);
      setCallStatus('Answered');
    });

    socketInstance.on('callRejected', (data) => {
      console.log(`Call ${data.callId} rejected`);
      setCallStatus('Rejected');
      setIncomingCall(null);
    });

    socketInstance.on('callEnded', () => {
      console.log('The call has ended.');
      setCallStatus('Ended');
      setIncomingCall(null);
      localStream = null;
      remoteStream = new MediaStream();
    });

    socketInstance.on('remoteStream', (stream) => {
      remoteStream = stream;
      console.log('Received remote stream:', stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    });

    return () => {
      if (socketInstance) socketInstance.disconnect();
      if (peerConnection) peerConnection.close();
    };
  }, []);

  const configuration = {
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "f69b20e8989d12a1b2691442",
        credential: "pwHhl5klFcFaJPer",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "f69b20e8989d12a1b2691442",
        credential: "pwHhl5klFcFaJPer",
      },
    ],
  };

  const setupWebRTCConnection = async (callType) => {
    try {
      console.log('Setting up WebRTC connection...');
      localStream = await navigator.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true,
      });
      console.log('Local stream captured:', localStream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      remoteStream = new MediaStream();
      peerConnection = new RTCPeerConnection(configuration);

      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      peerConnection.ontrack = (event) => {
        console.log('Received remote stream track:', event);
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE Candidate:', event.candidate);
          socket.emit('iceCandidate', { peerId: receiverId, candidate: event.candidate });
        }
      };

      if (callType === 'video') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { receiverId, offer });
      }
    } catch (err) {
      console.error('Error setting up WebRTC:', err);
    }
  };

  const handleAnswerCall = () => {
    if (socket && incomingCall) {
      console.log('Answering call:', incomingCall);
      socket.emit('answerCall', { callId: incomingCall.callId });
      setCallStatus('Answered');
      setIncomingCall(null);
      setupWebRTCConnection(incomingCall.callType);
    }
  };

  const handleRejectCall = () => {
    if (socket && incomingCall) {
      console.log('Rejecting call:', incomingCall);
      socket.emit('rejectCall', { callId: incomingCall.callId });
      setCallStatus('Rejected');
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    if (socket) {
      socket.emit('endCall');
      console.log('Ending the call');
      setCallStatus('Ended');
      localStream = null;
      remoteStream = new MediaStream();
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
    }
  };

  const initiateCall = (type) => {
    if (socket && receiverId) {
      socket.emit('initiateCall', { receiverId, callType: type });
      console.log(`Initiating ${type} call to ${receiverId}`);
      setCallStatus(`Calling ${receiverId}...`);
      setupWebRTCConnection(type);
    } else {
      console.log('Receiver ID is not set!');
    }
  };

  return (
    <div className="call-container">
      <h2>1-1 Calling</h2>

      <div className="video-call-container">
        <div className="video-box">
          <video ref={localVideoRef} className="local-video" autoPlay muted playsInline />
        </div>

        <div className="video-box">
          <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
        </div>
      </div>

      <div className="call-controls">
        <button className="control-btn" onClick={endCall}>End Call</button>
      </div>

      {incomingCall && callStatus === 'Incoming' && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Incoming call from {incomingCall.senderName}</h3>
            <button onClick={handleAnswerCall} className="answer-btn">Answer</button>
            <button onClick={handleRejectCall} className="reject-btn">Reject</button>
          </div>
        </div>
      )}

      <div className="call-initiation">
        <input
          type="text"
          placeholder="Enter participant ID"
          value={receiverId}
          onChange={(e) => setReceiverId(e.target.value)}
        />
        <br />
        <button onClick={() => initiateCall('audio')}>Start Audio Call</button>
        <button onClick={() => initiateCall('video')}>Start Video Call</button>
      </div>
    </div>
  );
};

export default CallComponent;
